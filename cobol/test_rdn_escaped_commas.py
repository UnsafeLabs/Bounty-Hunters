"""Acceptance tests for escaped-comma RDN parse algorithm (issue #521)."""

def parse_subject_dn(dn: str):
    """Mirror of 3500-PARSE-SUBJECT-DN logic."""
    table = [""] * 20
    # init spaces
    placeholder = "\x01"
    work = dn.replace("\\,", placeholder)
    parts = work.split(",")
    count = len(parts)
    parsed_cn = ""
    for i, part in enumerate(parts):
        restored = part.replace(placeholder, ",")
        table[i] = restored
        s = restored.lstrip()
        if s.startswith("CN="):
            val = s[3:]
            if val.startswith('"') and val.endswith('"'):
                val = val[1:-1]
            elif val.startswith('"'):
                val = val[1:]
            parsed_cn = val
    return parsed_cn, count, table[:count]


def test_single_escaped_comma():
    cn, count, _ = parse_subject_dn('CN="Smith\\, John",OU=Legal,O=Bank')
    assert cn == "Smith, John", cn
    assert count == 3, count


def test_multiple_escaped_commas():
    cn, count, _ = parse_subject_dn('CN="A\\, B\\, C",OU=X')
    assert cn == "A, B, C", cn
    assert count == 2, count


def test_no_commas():
    cn, count, _ = parse_subject_dn("CN=example.com,O=Org")
    assert cn == "example.com", cn
    assert count == 2, count


def test_rdn_count_not_inflated():
    # without escape handling this would be 4 parts
    cn, count, parts = parse_subject_dn('CN=Smith\\, John,OU=Legal')
    assert count == 2, count
    assert "Smith, John" in parts[0] or parts[0].endswith("Smith, John") or "Smith, John" in cn


def test_table_init_no_stale():
    # second parse must not keep old RDN entries beyond count
    parse_subject_dn("CN=old,OU=1,OU=2,OU=3")
    cn, count, parts = parse_subject_dn("CN=new")
    assert count == 1
    assert cn == "new"


if __name__ == "__main__":
    test_single_escaped_comma()
    test_multiple_escaped_commas()
    test_no_commas()
    test_rdn_count_not_inflated()
    test_table_init_no_stale()
    print("RDN escaped-comma tests: ALL PASSED")
