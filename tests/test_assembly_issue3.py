import pathlib
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]


class ContentTypeBoundsTests(unittest.TestCase):
    def test_upper_bound_rejects_values_above_tls_ct_max(self):
        source = (ROOT / "assembly" / "tls_record_parser.asm").read_text()
        bounds = source.split("; Validate content type range", 1)[1].split(".type_ok:", 1)[0]

        self.assertIn("cmp r13d, TLS_CT_MIN", bounds)
        self.assertIn("jl .invalid_type", bounds)
        self.assertIn("cmp r13d, TLS_CT_MAX", bounds)
        self.assertIn("jle .type_ok", bounds)
        self.assertIn("jg .invalid_type", bounds)


if __name__ == "__main__":
    unittest.main()
