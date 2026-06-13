const cases = [
  {
    name: "single escaped comma",
    input: String.raw`CN=Smith\, John,OU=Legal,O=Bank`,
    rdnCount: 3,
    cn: "Smith, John",
  },
  {
    name: "multiple escaped commas",
    input: String.raw`CN=Ops\, East\, Night,OU=Operations,O=Bank`,
    rdnCount: 3,
    cn: "Ops, East, Night",
  },
  {
    name: "no escaped comma",
    input: "CN=api.bank.example,OU=Payments,O=Bank",
    rdnCount: 3,
    cn: "api.bank.example",
  },
  {
    name: "quoted CN with escaped comma",
    input: String.raw`CN="Smith\, John",OU=Legal,O=Bank`,
    rdnCount: 3,
    cn: "Smith, John",
  },
];

function parseSubjectDn(dn) {
  const placeholder = "\u0000";
  const protectedDn = dn.replace(/\\,/g, `\\${placeholder}`);
  const rdns = protectedDn.split(",").map((entry) =>
    entry.replace(new RegExp(`\\\\${placeholder}`, "g"), ","),
  );
  const cnEntry = rdns.find((entry) => entry.startsWith("CN="));
  const cn = cnEntry ? cnEntry.slice(3).replaceAll('"', "").trim() : "";

  return { rdns, cn };
}

for (const testCase of cases) {
  const actual = parseSubjectDn(testCase.input);

  if (actual.rdns.length !== testCase.rdnCount) {
    throw new Error(
      `${testCase.name}: expected ${testCase.rdnCount} RDNs, got ${actual.rdns.length}`,
    );
  }

  if (actual.cn !== testCase.cn) {
    throw new Error(
      `${testCase.name}: expected CN ${JSON.stringify(testCase.cn)}, got ${JSON.stringify(actual.cn)}`,
    );
  }
}

console.log(`escaped comma RDN checks passed: ${cases.length}`);
