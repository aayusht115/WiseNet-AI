#!/usr/bin/env python3
import base64
import io
import json
import sys

from pypdf import PdfReader


def main() -> None:
    raw = sys.stdin.read()
    payload = json.loads(raw) if raw.strip() else {}
    file_base64 = str(payload.get("fileBase64", "")).strip()

    if not file_base64:
        print(json.dumps({"text": ""}))
        return

    pdf_bytes = base64.b64decode(file_base64)
    reader = PdfReader(io.BytesIO(pdf_bytes))

    text_chunks = []
    for page in reader.pages:
        extracted = (page.extract_text() or "").strip()
        if extracted:
            text_chunks.append(extracted)

    text = "\n".join(text_chunks)
    text = " ".join(text.split())
    print(json.dumps({"text": text}))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"error": str(exc)}))
        sys.exit(1)
