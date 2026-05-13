from pathlib import Path
import unittest


SOURCE = Path(__file__).with_name("tls_record_parser.asm").read_text()


class ContentTypeBoundsTests(unittest.TestCase):
    def test_types_above_max_branch_to_invalid_type(self):
        max_cmp = SOURCE.index("cmp r13d, TLS_CT_MAX")
        accept = SOURCE.index("jle .type_ok", max_cmp)
        reject = SOURCE.index("jg .invalid_type", accept)
        type_ok = SOURCE.index(".type_ok:", reject)

        self.assertLess(max_cmp, accept)
        self.assertLess(accept, reject)
        self.assertLess(reject, type_ok)


if __name__ == "__main__":
    unittest.main()
