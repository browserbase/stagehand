"""Download images discovered in a live page with Stagehand V4."""

import asyncio
import base64
import os
import re
import sys
import time
from pathlib import Path
from urllib.parse import urljoin, urlparse

from browserbase import AsyncBrowserbase
from dotenv import load_dotenv
from pydantic import BaseModel, Field
from stagehand import Page, Stagehand, browserbase

load_dotenv()

MAX_IMAGES = int(os.environ.get("MAX_IMAGES", "10"))
OUTPUT_DIR = Path("images")
MIME_TO_EXT = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/svg+xml": "svg",
    "image/avif": "avif",
    "image/bmp": "bmp",
    "image/tiff": "tiff",
}


class ImageUrls(BaseModel):
    urls: list[str] = Field(
        description="Absolute HTTP(S) image resource URLs from src or background-image values"
    )


def image_filename(url: str, mime_type: str, index: int) -> str:
    extension = MIME_TO_EXT.get(mime_type, "bin")
    segment = Path(urlparse(url).path).name
    stem = Path(segment).stem or f"image-{index}"
    safe_stem = re.sub(r"[^a-zA-Z0-9_-]", "_", stem)[:80]
    return f"{safe_stem}-{int(time.time() * 1000)}.{extension}"


async def fetch_image(api: AsyncBrowserbase, url: str) -> tuple[bytes, str] | None:
    result = await api.fetch_api.create(url=url, format="raw", allow_redirects=True)
    mime_type = (result.content_type or "").split(";", 1)[0]
    if not 200 <= result.status_code < 300 or not mime_type.startswith("image/"):
        return None
    if not isinstance(result.content, str):
        return None
    if result.encoding == "base64":
        payload = base64.b64decode(result.content)
    else:
        payload = result.content.encode(result.encoding or "utf-8")
    return payload, mime_type


async def exact_dom_image_urls(page: Page, target_url: str) -> list[str]:
    values = await page.evaluate(
        r"""(() => {
          const urls = new Set();
          for (const image of Array.from(document.images)) {
            if (image.currentSrc) urls.add(image.currentSrc);
            if (image.src) urls.add(image.src);
          }
          for (const element of Array.from(document.querySelectorAll('[style]'))) {
            const background = getComputedStyle(element).backgroundImage;
            for (const match of background.matchAll(/url\(["']?(.*?)["']?\)/g)) {
              if (match[1]) urls.add(new URL(match[1], document.baseURI).href);
            }
          }
          return [...urls];
        })()"""
    )
    if not isinstance(values, list):
        return []
    urls = []
    for value in values:
        absolute = urljoin(target_url, str(value))
        if urlparse(absolute).scheme in {"http", "https"} and absolute not in urls:
            urls.append(absolute)
    return urls


async def download_images(
    api: AsyncBrowserbase, urls: list[str], output_dir: Path
) -> tuple[int, int]:
    saved = 0
    failed = 0
    for index, url in enumerate(urls):
        try:
            fetched = await fetch_image(api, url)
        except Exception:
            fetched = None
        if fetched is None:
            failed += 1
            continue

        payload, mime_type = fetched
        filename = image_filename(url, mime_type, index)
        (output_dir / filename).write_bytes(payload)
        print(f"Saved {filename} ({len(payload)} bytes)")
        saved += 1
    return saved, failed


async def main() -> None:
    if len(sys.argv) < 2:
        raise RuntimeError("Usage: uv run python main.py <url>")
    target_url = sys.argv[1]
    api_key = os.environ.get("BROWSERBASE_API_KEY")
    if not api_key:
        raise RuntimeError("BROWSERBASE_API_KEY is required")

    browser = await browserbase.launch(api_key=api_key)
    try:
        stagehand = await Stagehand.create(
            browser=browser,
        )
        try:
            pages = await browser.context.pages()
            page = pages[0] if pages else await browser.context.new_page()
            await page.goto(target_url, wait_until="domcontentloaded", timeout=60_000)
            await page.wait_for_timeout(3_000)

            extracted = await stagehand.extract(
                (
                    "Extract all rendered image URLs on this page, including image src "
                    "attributes and background-image URLs. Return absolute HTTP(S) image "
                    "resource URLs exactly as rendered. Preserve every hostname character, "
                    "including any www prefix."
                ),
                ImageUrls,
                page=page,
            )
            normalized = []
            for value in extracted.data.urls:
                candidate = str(value)
                if not candidate.lower().startswith(("http://", "https://")):
                    continue
                absolute = candidate
                if urlparse(absolute).scheme in {"http", "https"} and absolute not in normalized:
                    normalized.append(absolute)
            if not normalized:
                # Accessibility snapshots can omit decorative images. Inspect the exact DOM
                # shape only when semantic extraction returns no usable candidates at all.
                normalized = await exact_dom_image_urls(page, target_url)
            urls = normalized[:MAX_IMAGES]
            hostname = urlparse(target_url).hostname or "unknown"
            output_dir = OUTPUT_DIR / hostname
            output_dir.mkdir(parents=True, exist_ok=True)
            async with AsyncBrowserbase(api_key=api_key) as api:
                saved, failed = await download_images(api, urls, output_dir)
                if saved == 0 and normalized:
                    # If semantic extraction produced URLs that cannot be fetched, fall back to
                    # exact DOM mechanics without changing the semantic-first discovery path.
                    fallback_urls = [
                        url
                        for url in await exact_dom_image_urls(page, target_url)
                        if url not in normalized
                    ][:MAX_IMAGES]
                    fallback_saved, fallback_failed = await download_images(
                        api, fallback_urls, output_dir
                    )
                    saved += fallback_saved
                    failed += fallback_failed

            print(f"Downloaded {saved} image(s); {failed} failed")
        finally:
            await stagehand.close()
    finally:
        await browser.close()
        print("Session closed successfully")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as error:
        print(f"Image download failed: {error}")
        print("Docs: https://docs.stagehand.dev/v4/first-steps/introduction")
        raise
