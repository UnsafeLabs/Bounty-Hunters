import asyncio, importlib.util, sys
from pathlib import Path
PATH=Path(__file__).resolve().parents[1]/fastapi/streaming_csv.py

def _load():
    name='scsv'
    if name in sys.modules: del sys.modules[name]
    spec=importlib.util.spec_from_file_location(name, PATH)
    mod=importlib.util.module_from_spec(spec)
    sys.modules[name]=mod
    spec.loader.exec_module(mod)
    return mod

def test_escape_and_stream():
    mod=_load()
    assert mod.csv_escape('a,b')=='"a,b"'
    assert mod.csv_escape('say "hi"')=='"say ""hi"""'
    assert mod.csv_escape('plain')=='plain'
    assert mod.format_csv_row(['a','b,c'], ',')=='a,"b,c"\n'

    async def rows():
        yield ['1','2']
        yield ['3','x,y']

    async def collect():
        out=[]
        async for line in mod.iter_csv(rows(), headers=['A','B']):
            out.append(line)
        return out

    lines=asyncio.run(collect())
    assert lines[0]=='A,B\n'
    assert lines[1]=='1,2\n'
    assert 'x,y' in lines[2]
    resp=mod.StreamingCSVResponse(rows(), headers=['A','B'], filename='data.csv')
    assert 'attachment' in resp.headers['content-disposition']
    assert resp.headers['content-type'].startswith('text/csv')
    # custom delimiter
    assert mod.format_csv_row(['a','b'], ';')=='a;b\n'
    print('ALL PASSED')

if __name__=='__main__':
    test_escape_and_stream()
