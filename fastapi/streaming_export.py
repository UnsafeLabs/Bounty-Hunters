# StreamingCSVResponse implementation for FastAPI large dataset exports
from fastapi import FastAPI, Response
from fastapi.responses import StreamingResponse
import csv
io = __import__('io')

app = FastAPI()

def generate_csv_rows(data_source):
    # CSV writer helper using StringIO generator
    io_stream = io.StringIO()
    writer = csv.writer(io_stream)
    
    # Write header
    writer.writerow(["id", "name", "value", "status"])
    yield io_stream.getvalue()
    io_stream.seek(0)
    io_stream.truncate(0)
    
    # Stream large dataset rows efficiently
    for row in data_source:
        writer.writerow(row)
        yield io_stream.getvalue()
        io_stream.seek(0)
        io_stream.truncate(0)

@app.get("/export-csv")
def export_large_csv():
    # Mock large dataset generator
    fake_large_dataset = ((i, f"Item_{i}", i * 1.5, "active") for i in range(10000))
    return StreamingResponse(
        generate_csv_rows(fake_large_dataset),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=large_export.csv"}
    )
