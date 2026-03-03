"""
StackOverflow – Search and extract top answers
Uses StackExchange API (no browser needed for search).

The public StackExchange API doesn't require authentication and bypasses
all anti-bot measures since it's meant for programmatic access.
"""
import re
import sys
import json
import html as html_module
from urllib.parse import quote_plus
from urllib.request import urlopen, Request

MAX_RESULTS = 5
DEFAULT_QUERY = "how to parse JSON in Python"


def search_stackoverflow_api(query: str, max_results: int = 5) -> list:
    """
    Search StackOverflow using the public API.
    Returns list of question dicts with question_id, title, link, score, answer_count.
    """
    api_url = (
        f"https://api.stackexchange.com/2.3/search/advanced"
        f"?order=desc&sort=votes&q={quote_plus(query)}"
        f"&site=stackoverflow&pagesize={max_results}&filter=withbody"
    )
    
    req = Request(api_url, headers={"Accept-Encoding": "gzip"})
    try:
        import gzip
        with urlopen(req, timeout=15) as resp:
            data = gzip.decompress(resp.read())
            result = json.loads(data)
            return result.get("items", [])
    except Exception as e:
        print(f"API Error: {e}")
        return []


def get_answers_api(question_id: int, max_results: int = 5) -> list:
    """
    Get answers for a question using the public API.
    Returns list of answer dicts with score, owner, body.
    """
    api_url = (
        f"https://api.stackexchange.com/2.3/questions/{question_id}/answers"
        f"?order=desc&sort=votes&site=stackoverflow&pagesize={max_results}&filter=withbody"
    )
    
    req = Request(api_url, headers={"Accept-Encoding": "gzip"})
    try:
        import gzip
        with urlopen(req, timeout=15) as resp:
            data = gzip.decompress(resp.read())
            result = json.loads(data)
            return result.get("items", [])
    except Exception as e:
        print(f"API Error: {e}")
        return []


def strip_html(html: str) -> str:
    """Remove HTML tags and decode entities."""
    text = re.sub(r'<[^>]+>', ' ', html)
    text = html_module.unescape(text)
    text = re.sub(r'\s+', ' ', text).strip()
    return text


def run(query: str = DEFAULT_QUERY, max_results: int = MAX_RESULTS) -> list:
    """
    Search StackOverflow for a question and get top answers.
    Uses API for reliability (no browser anti-bot issues).
    """
    print("=" * 59)
    print("  StackOverflow – Search & Extract Answers (API)")
    print("=" * 59)
    print(f'  Query: "{query}"')
    print(f"  Max results: {max_results}\n")
    
    # ── STEP 1: Search for questions ──────────────────────────────
    print("STEP 1: Search StackOverflow API...")
    questions = search_stackoverflow_api(query, max_results=1)
    
    if not questions:
        print("❌ ERROR: No questions found.")
        return []
    
    question = questions[0]
    question_id = question.get("question_id")
    title = strip_html(question.get("title", ""))
    link = question.get("link", "")
    score = question.get("score", 0)
    answer_count = question.get("answer_count", 0)
    
    print(f"   Found: {title}")
    print(f"   Score: {score} | Answers: {answer_count}")
    print(f"   Link: {link}\n")
    
    # ── STEP 2: Get answers ───────────────────────────────────────
    print("STEP 2: Fetch top answers from API...")
    api_answers = get_answers_api(question_id, max_results=max_results)
    
    if not api_answers:
        print("❌ ERROR: No answers found.")
        return []
    
    print(f"   Retrieved {len(api_answers)} answers\n")
    
    # ── STEP 3: Format results ────────────────────────────────────
    results = []
    for ans in api_answers:
        owner = ans.get("owner", {})
        author = owner.get("display_name", "N/A")
        votes = ans.get("score", 0)
        answer_id = ans.get("answer_id")
        answer_url = f"https://stackoverflow.com/a/{answer_id}" if answer_id else "N/A"
        body_html = ans.get("body", "")
        summary = strip_html(body_html)[:200]
        
        results.append({
            "votes": str(votes),
            "author": author,
            "url": answer_url,
            "summary": summary,
        })
    
    # ── Print results ─────────────────────────────────────────────
    print(f"DONE – Top {len(results)} Answers:\n")
    for i, a in enumerate(results, 1):
        print(f"  {i}. [{a['votes']} votes] by {a['author']}")
        print(f"     URL: {a['url']}")
        print(f"     {a['summary'][:120]}...")
        print()
    
    return results


if __name__ == "__main__":
    # Accept query as command line argument, or use default
    query = " ".join(sys.argv[1:]) if len(sys.argv) > 1 else DEFAULT_QUERY
    print(f"Query: {query}\n")
    run(query=query)
