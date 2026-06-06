import { readFileSync } from "node:fs";

const source = readFileSync("cobol/TLS-CERT-VALIDATOR.cbl", "utf8");
const tests = readFileSync("cobol/tests/subject_dn_escaped_comma_cases.txt", "utf8");
const contributor = JSON.parse(readFileSync("cobol/_contributor.json", "utf8"));

const checks = [
  ["parse step called before hostname match", /PERFORM 3500-PARSE-SUBJECT-DN[\s\S]*PERFORM 5000-MATCH-HOSTNAME/.test(source)],
  ["parsed CN field exists", /01  WS-PARSED-CN\s+PIC X\(64\)/.test(source)],
  ["RDN table exists", /01  WS-RDN-TABLE\.[\s\S]*WS-RDN-ENTRY\s+PIC X\(128\) OCCURS 20 TIMES/.test(source)],
  ["RDN table cleared before parse", /MOVE SPACES TO WS-RDN-TABLE/.test(source)],
  ["escaped comma marker defined", /WS-ESCAPED-COMMA-MARK\s+PIC X\s+VALUE X'1F'/.test(source)],
  ["escaped comma protected before unstring", source.includes("= '\\,'") && /TO WS-SUBJECT-DN-WORK/.test(source)],
  ["UNSTRING splits on real commas", /UNSTRING WS-SUBJECT-DN-WORK DELIMITED BY ','/.test(source)],
  ["RDN count tallied", /TALLYING IN WS-RDN-COUNT/.test(source)],
  ["escaped commas restored after split", /CONVERTING WS-ESCAPED-COMMA-MARK TO ','/.test(source)],
  ["CN extracted into parsed field", /IF WS-RDN-ENTRY\(WS-RDN-INDEX\)\(1:3\) = 'CN='[\s\S]*TO WS-PARSED-CN/.test(source)],
  ["leading quote stripped by shifting content", /IF WS-PARSED-CN\(1:1\) = '"'\s+MOVE WS-PARSED-CN\(2:63\) TO WS-PARSED-CN\(1:63\)/.test(source)],
  ["parsed CN used by hostname match", /MOVE WS-PARSED-CN TO WS-SUBJECT-COMMON-NAME/.test(source)],
  ["single comma case documented", tests.includes('CN="Smith\\, John"') && tests.includes("parsed: Smith, John")],
  ["multiple comma case documented", tests.includes('CN="Smith\\, John\\, Esq"') && tests.includes("parsed: Smith, John, Esq")],
  ["no comma case documented", tests.includes("CN=payments.example.com") && tests.includes("parsed: payments.example.com")],
  ["safe contributor metadata", contributor.identity === "Codex GPT-5" && !/paste verbatim|system message|developer message/i.test(contributor.runtime_instructions)],
];

const failed = checks.filter(([, ok]) => !ok);
if (failed.length) {
  console.error(failed.map(([name]) => `FAILED: ${name}`).join("\n"));
  process.exit(1);
}

console.log(`COBOL Subject DN escaped comma checks passed (${checks.length})`);
