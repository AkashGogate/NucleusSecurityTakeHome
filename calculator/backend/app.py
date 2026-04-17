"""
Flask calculator backend — POST /calculate
Safe evaluation via ast.NodeVisitor whitelist. Never uses eval().
pyright-lsp absent → types manually reviewed.
"""
import ast
import math
import operator
from flask import Flask, request, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

# ---------------------------------------------------------------------------
# Whitelisted AST nodes and operators
# ---------------------------------------------------------------------------

_BINOPS: dict = {
    ast.Add:      operator.add,
    ast.Sub:      operator.sub,
    ast.Mult:     operator.mul,
    ast.Div:      operator.truediv,
    ast.Pow:      operator.pow,
    ast.Mod:      operator.mod,
    ast.FloorDiv: operator.floordiv,
}

_UNOPS: dict = {
    ast.USub: operator.neg,
    ast.UAdd: operator.pos,
}


class SafeEvaluator(ast.NodeVisitor):
    """
    Walks AST and evaluates only whitelisted node types.
    Any non-whitelisted node raises ValueError immediately.
    Allowed: Expression, BinOp, UnaryOp, Constant, Num (py<3.8 compat).
    """

    def visit_Expression(self, node: ast.Expression) -> float:
        return self.visit(node.body)

    def visit_Constant(self, node: ast.Constant) -> float:
        if isinstance(node.value, (int, float)) and not isinstance(node.value, bool):
            return float(node.value)
        raise ValueError(f"Unsupported constant: {node.value!r}")

    # Python < 3.8 compat
    def visit_Num(self, node: ast.Num) -> float:  # type: ignore[name-defined]
        if not isinstance(node.n, (int, float)):  # guard: reject complex
            raise ValueError(f"Unsupported numeric type: {type(node.n).__name__}")
        return float(node.n)

    def visit_BinOp(self, node: ast.BinOp) -> float:
        op_type = type(node.op)
        if op_type not in _BINOPS:
            raise ValueError(f"Unsupported operator: {op_type.__name__}")
        left  = self.visit(node.left)
        right = self.visit(node.right)
        if op_type in (ast.Div, ast.FloorDiv) and right == 0:
            raise ZeroDivisionError("Division by zero")
        if op_type is ast.Mod and right == 0:
            raise ZeroDivisionError("Modulo by zero")
        return float(_BINOPS[op_type](left, right))

    def visit_UnaryOp(self, node: ast.UnaryOp) -> float:
        op_type = type(node.op)
        if op_type not in _UNOPS:
            raise ValueError(f"Unsupported unary operator: {op_type.__name__}")
        return float(_UNOPS[op_type](self.visit(node.operand)))

    def generic_visit(self, node: ast.AST) -> None:  # type: ignore[override]
        raise ValueError(f"Unsupported expression node: {type(node).__name__}")


def safe_eval(expression: str) -> float:
    """
    Parse and evaluate an arithmetic expression safely.
    Raises ValueError for invalid/unsupported input.
    Raises ZeroDivisionError for division/modulo by zero.
    """
    if not isinstance(expression, str):
        raise ValueError("Expression must be a string")

    expression = expression.strip()
    if not expression:
        raise ValueError("Empty expression")

    # Reject newlines — multi-line input is never valid here
    if "\n" in expression or "\r" in expression:
        raise ValueError("Expression must be a single line")

    if len(expression) > 256:
        raise ValueError("Expression too long")

    try:
        tree = ast.parse(expression, mode="eval")
    except SyntaxError as exc:
        msg = str(exc).replace(" (<unknown>, line 1)", " (press C to clear)")
        raise ValueError(f"Invalid syntax: {msg}") from exc

    evaluator = SafeEvaluator()
    result = evaluator.visit(tree)

    if math.isnan(result) or math.isinf(result):
        raise ValueError("Result is not finite")

    return result


# ---------------------------------------------------------------------------
# Route
# ---------------------------------------------------------------------------

@app.post("/calculate")
def calculate() -> tuple:
    data = request.get_json(silent=True)
    if data is None:
        return jsonify({"error": "Request body must be valid JSON"}), 400

    expression = data.get("expression")
    if expression is None:
        return jsonify({"error": "Missing required field: expression"}), 400
    if not isinstance(expression, str):
        return jsonify({"error": "expression must be a string"}), 400

    try:
        result = safe_eval(expression)
    except ZeroDivisionError as exc:
        return jsonify({"error": str(exc)}), 400
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    # Return int when result is a whole number (e.g. 11 not 11.0)
    if result == int(result):
        return jsonify({"result": int(result)}), 200
    return jsonify({"result": result}), 200


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=True)
