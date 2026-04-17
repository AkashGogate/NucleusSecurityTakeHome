"""
pytest suite — all 14 spec cases + extras.
TDD: this file was written before app.py implementation.
pyright-lsp absent → types reviewed manually.
"""
import pytest
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app import app, safe_eval


# ---------------------------------------------------------------------------
# Unit tests — safe_eval (the 14 spec cases + supporting cases)
# ---------------------------------------------------------------------------

class TestSafeEval:
    # Spec case 1
    def test_addition(self):
        assert safe_eval("2+2") == 4

    # Spec case 2
    def test_division_float(self):
        assert safe_eval("10/4") == 2.5

    # Spec case 3
    def test_power(self):
        assert safe_eval("3**2") == 9

    # Spec case 4
    def test_modulo(self):
        assert safe_eval("10%3") == 1

    # Spec case 5 — operator precedence
    def test_precedence(self):
        assert safe_eval("3+4*2") == 11

    # Spec case 6
    def test_negative(self):
        assert safe_eval("-5+3") == -2

    # Spec case 7
    def test_float_multiply(self):
        assert safe_eval("1.5*2") == 3.0

    # Spec case 8 — parentheses
    def test_parens(self):
        assert safe_eval("(2+3)*4") == 20

    # Spec case 9 — error: division by zero
    def test_div_zero(self):
        with pytest.raises(ZeroDivisionError):
            safe_eval("1/0")

    # Spec case 10 — error: empty string
    def test_empty(self):
        with pytest.raises(ValueError):
            safe_eval("")

    # Spec case 11 — error: alphabetic
    def test_alpha(self):
        with pytest.raises(ValueError):
            safe_eval("abc")

    # Spec case 12 — error: __import__
    def test_import_attack(self):
        with pytest.raises(ValueError):
            safe_eval("__import__('os')")

    # Spec case 13 — error: open()
    def test_open_attack(self):
        with pytest.raises(ValueError):
            safe_eval("open('/etc/passwd')")

    # Spec case 14 — error: newline in expression
    def test_newline_rejected(self):
        with pytest.raises(ValueError):
            safe_eval("1+\n2")

    # Additional safety cases
    def test_exec_rejected(self):
        with pytest.raises(ValueError):
            safe_eval("exec('import os')")

    def test_string_literal_rejected(self):
        with pytest.raises(ValueError):
            safe_eval("'hello'")

    def test_list_rejected(self):
        with pytest.raises(ValueError):
            safe_eval("[1,2,3]")

    def test_modulo_zero(self):
        with pytest.raises(ZeroDivisionError):
            safe_eval("5%0")

    def test_nested_parens(self):
        assert safe_eval("((2+3)*4)/2") == 10.0

    def test_negative_times_negative(self):
        assert safe_eval("-3*-4") == 12

    def test_whitespace_only(self):
        with pytest.raises(ValueError):
            safe_eval("   ")

    def test_too_long(self):
        with pytest.raises(ValueError):
            safe_eval("1+" * 200)

    # Edge cases not covered above
    def test_subtraction(self):
        assert safe_eval("5-3") == 2

    def test_floor_div(self):
        assert safe_eval("7//2") == 3

    def test_floor_div_zero(self):
        with pytest.raises(ZeroDivisionError):
            safe_eval("7//0")

    def test_unary_plus(self):
        assert safe_eval("+5") == 5.0

    def test_inf_result_rejected(self):
        with pytest.raises(ValueError):
            safe_eval("1e308*10")

    def test_carriage_return_rejected(self):
        with pytest.raises(ValueError):
            safe_eval("1+\r2")

    def test_boolean_rejected(self):
        with pytest.raises(ValueError):
            safe_eval("True")

    def test_attribute_access_rejected(self):
        with pytest.raises(ValueError):
            safe_eval("(1).real")

    def test_dict_rejected(self):
        with pytest.raises(ValueError):
            safe_eval("{1:2}")

    def test_compare_rejected(self):
        with pytest.raises(ValueError):
            safe_eval("1==1")

    def test_lambda_rejected(self):
        with pytest.raises(ValueError):
            safe_eval("lambda: 1")

    def test_subtraction_float(self):
        assert safe_eval("10.5-0.5") == 10.0

    def test_deep_nesting(self):
        assert safe_eval("((((2+2))))") == 4.0

    def test_whole_number_float_input(self):
        # 4.0/2.0 → result 2.0; safe_eval always returns float
        assert safe_eval("4.0/2.0") == 2.0


# ---------------------------------------------------------------------------
# Integration tests — Flask endpoint
# ---------------------------------------------------------------------------

@pytest.fixture
def client():
    app.config["TESTING"] = True
    with app.test_client() as c:
        yield c


class TestCalculateEndpoint:
    def test_addition(self, client):
        r = client.post("/calculate", json={"expression": "2+2"})
        assert r.status_code == 200
        assert r.get_json()["result"] == 4

    def test_precedence(self, client):
        r = client.post("/calculate", json={"expression": "3+4*2"})
        assert r.status_code == 200
        assert r.get_json()["result"] == 11

    def test_float(self, client):
        r = client.post("/calculate", json={"expression": "10/4"})
        assert r.status_code == 200
        assert r.get_json()["result"] == 2.5

    def test_power(self, client):
        r = client.post("/calculate", json={"expression": "3**2"})
        assert r.status_code == 200
        assert r.get_json()["result"] == 9

    def test_modulo(self, client):
        r = client.post("/calculate", json={"expression": "10%3"})
        assert r.status_code == 200
        assert r.get_json()["result"] == 1

    def test_negative(self, client):
        r = client.post("/calculate", json={"expression": "-5+3"})
        assert r.status_code == 200
        assert r.get_json()["result"] == -2

    def test_float_input(self, client):
        r = client.post("/calculate", json={"expression": "1.5*2"})
        assert r.status_code == 200
        assert r.get_json()["result"] == 3.0

    def test_parens(self, client):
        r = client.post("/calculate", json={"expression": "(2+3)*4"})
        assert r.status_code == 200
        assert r.get_json()["result"] == 20

    def test_div_zero_400(self, client):
        r = client.post("/calculate", json={"expression": "1/0"})
        assert r.status_code == 400
        assert "error" in r.get_json()

    def test_empty_400(self, client):
        r = client.post("/calculate", json={"expression": ""})
        assert r.status_code == 400
        assert "error" in r.get_json()

    def test_alpha_400(self, client):
        r = client.post("/calculate", json={"expression": "abc"})
        assert r.status_code == 400
        assert "error" in r.get_json()

    def test_import_400(self, client):
        r = client.post("/calculate", json={"expression": "__import__('os')"})
        assert r.status_code == 400
        assert "error" in r.get_json()

    def test_open_400(self, client):
        r = client.post("/calculate", json={"expression": "open('/etc/passwd')"})
        assert r.status_code == 400
        assert "error" in r.get_json()

    def test_newline_400(self, client):
        r = client.post("/calculate", json={"expression": "1+\n2"})
        assert r.status_code == 400
        assert "error" in r.get_json()

    def test_no_body_400(self, client):
        r = client.post("/calculate", data="not json",
                        content_type="application/json")
        assert r.status_code == 400

    def test_missing_key_400(self, client):
        r = client.post("/calculate", json={})
        assert r.status_code == 400

    def test_non_string_400(self, client):
        r = client.post("/calculate", json={"expression": 42})
        assert r.status_code == 400

    def test_floor_div_200(self, client):
        r = client.post("/calculate", json={"expression": "7//2"})
        assert r.status_code == 200
        assert r.get_json()["result"] == 3

    def test_floor_div_zero_400(self, client):
        r = client.post("/calculate", json={"expression": "7//0"})
        assert r.status_code == 400
        assert "error" in r.get_json()

    def test_modulo_zero_400(self, client):
        r = client.post("/calculate", json={"expression": "5%0"})
        assert r.status_code == 400
        assert "error" in r.get_json()

    def test_too_long_400(self, client):
        r = client.post("/calculate", json={"expression": "1+" * 200})
        assert r.status_code == 400
        assert "error" in r.get_json()

    def test_whitespace_only_400(self, client):
        r = client.post("/calculate", json={"expression": "   "})
        assert r.status_code == 400
        assert "error" in r.get_json()

    def test_get_method_405(self, client):
        r = client.get("/calculate")
        assert r.status_code == 405

    def test_expression_null_400(self, client):
        r = client.post("/calculate", json={"expression": None})
        assert r.status_code == 400
        assert "error" in r.get_json()

    def test_expression_bool_400(self, client):
        r = client.post("/calculate", json={"expression": True})
        assert r.status_code == 400
        assert "error" in r.get_json()

    def test_extra_fields_ok(self, client):
        r = client.post("/calculate", json={"expression": "2+2", "extra": "ignored"})
        assert r.status_code == 200
        assert r.get_json()["result"] == 4

    def test_whole_number_result_is_int(self, client):
        r = client.post("/calculate", json={"expression": "6/2"})
        assert r.status_code == 200
        result = r.get_json()["result"]
        assert result == 3
        assert isinstance(result, int)

    def test_inf_rejected_400(self, client):
        r = client.post("/calculate", json={"expression": "1e308*10"})
        assert r.status_code == 400
        assert "error" in r.get_json()

    def test_carriage_return_400(self, client):
        r = client.post("/calculate", json={"expression": "1+\r2"})
        assert r.status_code == 400
        assert "error" in r.get_json()

    def test_subtraction_200(self, client):
        r = client.post("/calculate", json={"expression": "10-3"})
        assert r.status_code == 200
        assert r.get_json()["result"] == 7

    def test_large_power_200(self, client):
        r = client.post("/calculate", json={"expression": "2**10"})
        assert r.status_code == 200
        assert r.get_json()["result"] == 1024

    def test_response_has_no_extra_keys_on_success(self, client):
        r = client.post("/calculate", json={"expression": "1+1"})
        assert r.status_code == 200
        data = r.get_json()
        assert set(data.keys()) == {"result"}

    def test_response_has_no_extra_keys_on_error(self, client):
        r = client.post("/calculate", json={"expression": "abc"})
        assert r.status_code == 400
        data = r.get_json()
        assert set(data.keys()) == {"error"}
