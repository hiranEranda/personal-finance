from pathlib import Path
from markitdown import MarkItDown

_converter = MarkItDown()


def parse_to_markdown(pdf_path: Path) -> str:
    result = _converter.convert(str(pdf_path))
    return result.text_content
