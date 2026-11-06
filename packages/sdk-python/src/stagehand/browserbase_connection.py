from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING

from ._generated.models import BrowserbaseRegion

if TYPE_CHECKING:
    from .browser import _WorkerInitMetadata
    from .client_models import StagehandClientCreateConfig

_REGION_API_URLS: dict[BrowserbaseRegion, str] = {
    BrowserbaseRegion.us_west_2: "https://api.stagehand.browserbase.com",
    BrowserbaseRegion.us_east_1: "https://api.use1.stagehand.browserbase.com",
    BrowserbaseRegion.eu_central_1: "https://api.euc1.stagehand.browserbase.com",
    BrowserbaseRegion.ap_southeast_1: "https://api.apse1.stagehand.browserbase.com",
}


@dataclass(frozen=True)
class BrowserbaseConnection:
    api_key: str = field(repr=False)
    api_url: str
    session_id: str


def resolve_browserbase_connection(
    create_config: StagehandClientCreateConfig,
    worker_init_metadata: _WorkerInitMetadata,
) -> BrowserbaseConnection | None:
    """Resolve Gateway/cache settings from validated options and claimed metadata."""
    api_key = worker_init_metadata.api_key
    if api_key is None:
        api_key = create_config.api_key
    browser = worker_init_metadata.browser
    if not api_key or browser is None or not browser.session_id:
        return None

    base_url = create_config.api_url
    if base_url is None:
        base_url = _REGION_API_URLS[browser.region or BrowserbaseRegion.us_west_2]
    return BrowserbaseConnection(
        api_key=api_key,
        api_url=f"{base_url.rstrip('/')}/v1",
        session_id=browser.session_id,
    )
