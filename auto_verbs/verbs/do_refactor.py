#!/usr/bin/env python3
"""
Bulk refactor: for every verbs subfolder (except airbnb_com which is already done
and __pycache__), transform the primary .py file to match the pattern in
prompt-create-verb.txt:
  - Typed Request / Result / Item dataclasses
  - Generalized automation function (wraps existing run() body)
  - Date calculations moved to test code
  - Test function that computes dates and calls the automation function
  - signature.txt generated alongside

Run from:  /workspaces/stagehand/auto_verbs/verbs/
"""

import os
import textwrap
from datetime import date
from pathlib import Path

VERBS_DIR = Path(__file__).parent

# ------------------------------------------------------------------
# Per-folder metadata: (request_fields, result_item_fields, func_name, description)
#   request_fields : list of (name, type_str, default_str_or_None)
#   item_fields    : list of (name, type_str)
#   result_fields  : list of (name, type_str)   (if not just items)
#   func_name      : new function name (replaces run())
#   description    : first-line comment for the function
#
# For folders whose existing run() already takes explicit args, those args
# become the Request fields.  For folders with no-arg run(), we derive the
# fields from the trajectory prompt.
# ------------------------------------------------------------------

FOLDER_META = {
    "alaskaair_com": dict(
        func_name="search_alaska_flights",
        description="Searches Alaska Airlines for round-trip flights and returns up to max_results economy options.",
        req_fields=[
            ("origin", "str", '"Seattle"'),
            ("destination", "str", '"Chicago"'),
            ("departure_date", "date", None),
            ("return_date", "date", None),
            ("max_results", "int", "5"),
        ],
        item_class="AlaskaFlight",
        item_fields=[("itinerary", "str"), ("economy_price", "str")],
        result_class="AlaskaFlightSearchResult",
        result_fields=[("origin", "str"), ("destination", "str"),
                       ("departure_date", "date"), ("return_date", "date"),
                       ("flights", "list[AlaskaFlight]")],
        test_dates={"departure_date": "today + relativedelta(months=2)",
                    "return_date": "departure_date + timedelta(days=4)"},
    ),
    "amazon_com": dict(
        func_name="clear_amazon_cart",
        description="Clears all items from the Amazon shopping cart and returns True on success.",
        req_fields=[],
        item_class=None,
        item_fields=[],
        result_class="AmazonClearCartResult",
        result_fields=[("success", "bool")],
        test_dates={},
    ),
    "amtrak_com": dict(
        func_name="search_amtrak_trains",
        description="Searches Amtrak for one-way train tickets and returns up to max_results options.",
        req_fields=[
            ("origin", "str", '"Seattle, WA"'),
            ("destination", "str", '"Portland, OR"'),
            ("departure_date", "date", None),
            ("max_results", "int", "5"),
        ],
        item_class="AmtrakTrain",
        item_fields=[("departure_time", "str"), ("arrival_time", "str"),
                     ("duration", "str"), ("price", "str")],
        result_class="AmtrakSearchResult",
        result_fields=[("origin", "str"), ("destination", "str"),
                       ("departure_date", "date"), ("trains", "list[AmtrakTrain]")],
        test_dates={"departure_date": "today + relativedelta(months=2)"},
    ),
    "apartments_com": dict(
        func_name="search_apartments",
        description="Searches Apartments.com for listings in a location within a price range, returns up to max_results.",
        req_fields=[
            ("location", "str", '"Austin, TX"'),
            ("price_min", "int", "1000"),
            ("price_max", "int", "2000"),
            ("max_results", "int", "5"),
        ],
        item_class="ApartmentListing",
        item_fields=[("name", "str"), ("price", "str"), ("beds", "str")],
        result_class="ApartmentsSearchResult",
        result_fields=[("location", "str"), ("listings", "list[ApartmentListing]")],
        test_dates={},
    ),
    "bankofamerica_com": dict(
        func_name="locate_boa_atms",
        description="Locates Bank of America ATMs near a given address and returns up to max_results results.",
        req_fields=[
            ("location", "str", '"Redmond, WA 98052"'),
            ("max_results", "int", "5"),
        ],
        item_class="BoaAtm",
        item_fields=[("name", "str"), ("address", "str"), ("distance", "str")],
        result_class="BoaLocatorResult",
        result_fields=[("location", "str"), ("atms", "list[BoaAtm]")],
        test_dates={},
    ),
    "bbc_com": dict(
        func_name="extract_bbc_headlines",
        description="Extracts the top headline stories from BBC News and returns up to max_results items.",
        req_fields=[("max_results", "int", "5")],
        item_class="BbcHeadline",
        item_fields=[("title", "str"), ("url", "str"), ("summary", "str")],
        result_class="BbcNewsResult",
        result_fields=[("headlines", "list[BbcHeadline]")],
        test_dates={},
    ),
    "bestbuy_com": dict(
        func_name="search_bestbuy_products",
        description="Searches Best Buy for products matching a search term and returns up to max_results listings.",
        req_fields=[
            ("search_term", "str", '"4K monitor"'),
            ("max_results", "int", "5"),
        ],
        item_class="BestBuyProduct",
        item_fields=[("name", "str"), ("price", "str"), ("rating", "str")],
        result_class="BestBuySearchResult",
        result_fields=[("search_term", "str"), ("products", "list[BestBuyProduct]")],
        test_dates={},
    ),
    "booking_com": dict(
        func_name="search_booking_hotels",
        description="Searches Booking.com for hotels at a destination over given dates and returns up to max_results.",
        req_fields=[
            ("destination", "str", '"Chicago"'),
            ("checkin_date", "date", None),
            ("checkout_date", "date", None),
            ("max_results", "int", "5"),
        ],
        item_class="BookingHotel",
        item_fields=[("name", "str"), ("price_per_night", "str"), ("rating", "str")],
        result_class="BookingSearchResult",
        result_fields=[("destination", "str"), ("checkin_date", "date"),
                       ("checkout_date", "date"), ("hotels", "list[BookingHotel]")],
        test_dates={"checkin_date": "today + relativedelta(months=2)",
                    "checkout_date": "checkin_date + timedelta(days=2)"},
    ),
    "chase_com": dict(
        func_name="search_chase_branches",
        description="Searches for Chase Bank branches near a location and returns up to max_results results.",
        req_fields=[
            ("location", "str", '"Seattle, WA 98101"'),
            ("max_results", "int", "5"),
        ],
        item_class="ChaseBranch",
        item_fields=[("name", "str"), ("address", "str"), ("hours", "str")],
        result_class="ChaseSearchResult",
        result_fields=[("location", "str"), ("branches", "list[ChaseBranch]")],
        test_dates={},
    ),
    "costco_com": dict(
        func_name="search_costco_products",
        description="Searches Costco for products matching a query and returns up to max_results listings.",
        req_fields=[
            ("search_query", "str", '"kids winter jacket"'),
            ("max_results", "int", "5"),
        ],
        item_class="CostcoProduct",
        item_fields=[("name", "str"), ("price", "str"), ("item_number", "str")],
        result_class="CostcoSearchResult",
        result_fields=[("search_query", "str"), ("products", "list[CostcoProduct]")],
        test_dates={},
    ),
    "coursera_org": dict(
        func_name="search_coursera_courses",
        description="Searches Coursera for courses matching a term and returns up to max_results results.",
        req_fields=[
            ("search_term", "str", '"machine learning"'),
            ("max_results", "int", "5"),
        ],
        item_class="CourseraCourse",
        item_fields=[("title", "str"), ("provider", "str"), ("rating", "str")],
        result_class="CourseraSearchResult",
        result_fields=[("search_term", "str"), ("courses", "list[CourseraCourse]")],
        test_dates={},
    ),
    "ctrip": dict(
        func_name="search_ctrip_trains",
        description="Searches Ctrip for one-way train tickets and returns up to max_results options.",
        req_fields=[
            ("from_station", "str", '"上海"'),
            ("to_station", "str", '"福州"'),
            ("departure_date", "date", None),
            ("max_results", "int", "5"),
        ],
        item_class="CtripTrain",
        item_fields=[("departure_time", "str"), ("arrival_time", "str"),
                     ("duration", "str"), ("price", "str")],
        result_class="CtripSearchResult",
        result_fields=[("from_station", "str"), ("to_station", "str"),
                       ("departure_date", "date"), ("trains", "list[CtripTrain]")],
        test_dates={"departure_date": "today + timedelta(days=4)"},
    ),
    "cvs_com": dict(
        func_name="search_cvs_stores",
        description="Searches for CVS store locations near a ZIP code and returns up to max_results results.",
        req_fields=[
            ("zip_code", "str", '"10001"'),
            ("max_results", "int", "5"),
        ],
        item_class="CvsStore",
        item_fields=[("name", "str"), ("address", "str"), ("hours", "str")],
        result_class="CvsSearchResult",
        result_fields=[("zip_code", "str"), ("stores", "list[CvsStore]")],
        test_dates={},
    ),
    "doordash_com": dict(
        func_name="search_doordash_restaurants",
        description="Searches DoorDash for nearby restaurants and returns available options.",
        req_fields=[
            ("address", "str", '"Chicago, IL 60601"'),
            ("cuisine", "str", '"Thai food"'),
            ("max_results", "int", "5"),
        ],
        item_class="DoordashRestaurant",
        item_fields=[("name", "str"), ("rating", "str"), ("delivery_time", "str")],
        result_class="DoordashSearchResult",
        result_fields=[("address", "str"), ("cuisine", "str"),
                       ("restaurants", "list[DoordashRestaurant]")],
        test_dates={},
    ),
    "ebay_com": dict(
        func_name="search_ebay_listings",
        description="Searches eBay for listings matching a query and returns up to max_results items.",
        req_fields=[
            ("search_query", "str", '"vintage camera"'),
            ("max_results", "int", "5"),
        ],
        item_class="EbayListing",
        item_fields=[("title", "str"), ("price", "str"), ("condition", "str")],
        result_class="EbaySearchResult",
        result_fields=[("search_query", "str"), ("listings", "list[EbayListing]")],
        test_dates={},
    ),
    "etsy_com": dict(
        func_name="search_etsy_listings",
        description="Searches Etsy for handmade/vintage listings matching a query and returns up to max_results items.",
        req_fields=[
            ("search_query", "str", '"handmade candle"'),
            ("max_results", "int", "5"),
        ],
        item_class="EtsyListing",
        item_fields=[("title", "str"), ("price", "str"), ("shop_name", "str")],
        result_class="EtsySearchResult",
        result_fields=[("search_query", "str"), ("listings", "list[EtsyListing]")],
        test_dates={},
    ),
    "expedia_com": dict(
        func_name="search_expedia_hotels",
        description="Searches Expedia for hotels at a destination over given dates and returns up to max_results.",
        req_fields=[
            ("destination", "str", '"Chicago"'),
            ("checkin_date", "date", None),
            ("checkout_date", "date", None),
            ("max_results", "int", "5"),
        ],
        item_class="ExpediaHotel",
        item_fields=[("name", "str"), ("price_per_night", "str"), ("rating", "str")],
        result_class="ExpediaSearchResult",
        result_fields=[("destination", "str"), ("checkin_date", "date"),
                       ("checkout_date", "date"), ("hotels", "list[ExpediaHotel]")],
        test_dates={"checkin_date": "today + relativedelta(months=2)",
                    "checkout_date": "checkin_date + timedelta(days=3)"},
    ),
    "fidelity_com": dict(
        func_name="get_fidelity_portfolio",
        description="Logs into Fidelity and returns a summary of the portfolio including balances.",
        req_fields=[],
        item_class=None,
        item_fields=[],
        result_class="FidelityPortfolioResult",
        result_fields=[("total_value", "str"), ("accounts", "list[str]")],
        test_dates={},
    ),
    "flights_google_com": dict(
        func_name="search_google_flights",
        description="Searches Google Flights for round-trip flights and returns up to max_results options.",
        req_fields=[
            ("origin", "str", '"Seattle"'),
            ("destination", "str", '"Chicago"'),
            ("departure_date", "date", None),
            ("return_date", "date", None),
            ("max_results", "int", "5"),
        ],
        item_class="GoogleFlight",
        item_fields=[("itinerary", "str"), ("price", "str"), ("duration", "str")],
        result_class="GoogleFlightsResult",
        result_fields=[("origin", "str"), ("destination", "str"),
                       ("departure_date", "date"), ("return_date", "date"),
                       ("flights", "list[GoogleFlight]")],
        test_dates={"departure_date": "today + relativedelta(months=2)",
                    "return_date": "departure_date + timedelta(days=4)"},
    ),
    "github_com": dict(
        func_name="search_github_repos",
        description="Searches GitHub for repositories matching a search term and returns up to max_results.",
        req_fields=[
            ("search_term", "str", '"browser automation"'),
            ("max_results", "int", "5"),
        ],
        item_class="GithubRepo",
        item_fields=[("name", "str"), ("url", "str"), ("stars", "str"), ("description", "str")],
        result_class="GithubSearchResult",
        result_fields=[("search_term", "str"), ("repos", "list[GithubRepo]")],
        test_dates={},
    ),
    "glassdoor_com": dict(
        func_name="search_glassdoor_jobs",
        description="Searches Glassdoor for job listings and company reviews, returning a result summary.",
        req_fields=[
            ("job_title", "str", '"Software Engineer"'),
            ("location", "str", '"Seattle, WA"'),
            ("max_results", "int", "5"),
        ],
        item_class="GlassdoorJob",
        item_fields=[("title", "str"), ("company", "str"), ("salary", "str"), ("rating", "str")],
        result_class="GlassdoorSearchResult",
        result_fields=[("job_title", "str"), ("location", "str"),
                       ("jobs", "list[GlassdoorJob]")],
        test_dates={},
    ),
    "groupon": dict(
        func_name="search_groupon_deals",
        description="Searches Groupon for deals matching a keyword and returns up to max_results deals.",
        req_fields=[
            ("keyword", "str", '"synthetic oil change"'),
            ("max_results", "int", "5"),
        ],
        item_class="GrouponDeal",
        item_fields=[("name", "str"), ("deal_price", "str"), ("discount_pct", "str")],
        result_class="GrouponSearchResult",
        result_fields=[("keyword", "str"), ("deals", "list[GrouponDeal]")],
        test_dates={},
    ),
    "grubhub_com": dict(
        func_name="search_grubhub_restaurants",
        description="Sets a Grubhub delivery address and searches for Thai food restaurants, returning top results.",
        req_fields=[
            ("address", "str", '"Chicago, IL 60601"'),
            ("cuisine", "str", '"Thai food"'),
            ("max_results", "int", "5"),
        ],
        item_class="GrubhubRestaurant",
        item_fields=[("name", "str"), ("rating", "str"), ("delivery_time", "str")],
        result_class="GrubhubSearchResult",
        result_fields=[("address", "str"), ("cuisine", "str"),
                       ("restaurants", "list[GrubhubRestaurant]")],
        test_dates={},
    ),
    "hertz_com": dict(
        func_name="search_hertz_cars",
        description="Searches Hertz for available car rentals at a pickup location over given dates, returning up to max_results cars.",
        req_fields=[
            ("pickup_location", "str", '"Los Angeles International Airport (LAX)"'),
            ("pickup_date", "date", None),
            ("dropoff_date", "date", None),
            ("max_results", "int", "5"),
        ],
        item_class="HertzCar",
        item_fields=[("car_class", "str"), ("model", "str"), ("daily_price", "str")],
        result_class="HertzSearchResult",
        result_fields=[("pickup_location", "str"), ("pickup_date", "date"),
                       ("dropoff_date", "date"), ("cars", "list[HertzCar]")],
        test_dates={"pickup_date": "today + relativedelta(months=2)",
                    "dropoff_date": "pickup_date + timedelta(days=5)"},
    ),
    "homedepot_com": dict(
        func_name="search_homedepot_products",
        description="Searches Home Depot for products matching a query and returns up to max_results listings.",
        req_fields=[
            ("search_query", "str", '"power drill"'),
            ("max_results", "int", "5"),
        ],
        item_class="HomeDepotProduct",
        item_fields=[("name", "str"), ("price", "str"), ("model_number", "str")],
        result_class="HomeDepotSearchResult",
        result_fields=[("search_query", "str"), ("products", "list[HomeDepotProduct]")],
        test_dates={},
    ),
    "imdb_com": dict(
        func_name="search_imdb_titles",
        description="Searches IMDb for movies or TV shows matching a query and returns up to max_results results.",
        req_fields=[
            ("search_query", "str", '"Christopher Nolan"'),
            ("max_results", "int", "5"),
        ],
        item_class="ImdbTitle",
        item_fields=[("title", "str"), ("year", "str"), ("rating", "str")],
        result_class="ImdbSearchResult",
        result_fields=[("search_query", "str"), ("titles", "list[ImdbTitle]")],
        test_dates={},
    ),
    "indeed_com": dict(
        func_name="search_indeed_jobs",
        description="Searches Indeed for job listings matching a job title and location and returns up to max_results.",
        req_fields=[
            ("job_title", "str", '"Software Engineer"'),
            ("location", "str", '"Seattle, WA"'),
            ("max_results", "int", "5"),
        ],
        item_class="IndeedJob",
        item_fields=[("title", "str"), ("company", "str"), ("location", "str"), ("salary", "str")],
        result_class="IndeedSearchResult",
        result_fields=[("job_title", "str"), ("location", "str"),
                       ("jobs", "list[IndeedJob]")],
        test_dates={},
    ),
    "irs_gov": dict(
        func_name="search_irs_resources",
        description="Searches the IRS website for tax-related resources and returns up to max_results results.",
        req_fields=[
            ("search_term", "str", '"tax refund status"'),
            ("max_results", "int", "5"),
        ],
        item_class="IrsResource",
        item_fields=[("title", "str"), ("url", "str"), ("description", "str")],
        result_class="IrsSearchResult",
        result_fields=[("search_term", "str"), ("resources", "list[IrsResource]")],
        test_dates={},
    ),
    "kayak_com": dict(
        func_name="search_kayak_flights",
        description="Searches Kayak for round-trip flights and returns up to max_results options.",
        req_fields=[
            ("origin", "str", '"Seattle"'),
            ("destination", "str", '"Chicago"'),
            ("departure_date", "date", None),
            ("return_date", "date", None),
            ("max_results", "int", "5"),
        ],
        item_class="KayakFlight",
        item_fields=[("itinerary", "str"), ("price", "str"), ("duration", "str")],
        result_class="KayakSearchResult",
        result_fields=[("origin", "str"), ("destination", "str"),
                       ("departure_date", "date"), ("return_date", "date"),
                       ("flights", "list[KayakFlight]")],
        test_dates={"departure_date": "today + relativedelta(months=2)",
                    "return_date": "departure_date + timedelta(days=4)"},
    ),
    "khanacademy_org": dict(
        func_name="search_khanacademy_courses",
        description="Searches Khan Academy for courses or exercises and returns up to max_results results.",
        req_fields=[
            ("search_term", "str", '"algebra"'),
            ("max_results", "int", "5"),
        ],
        item_class="KhanCourse",
        item_fields=[("title", "str"), ("url", "str"), ("subject", "str")],
        result_class="KhanSearchResult",
        result_fields=[("search_term", "str"), ("courses", "list[KhanCourse]")],
        test_dates={},
    ),
    "linkedin_com": dict(
        func_name="search_linkedin_jobs",
        description="Searches LinkedIn for job postings and returns up to max_results results.",
        req_fields=[
            ("job_title", "str", '"Software Engineer"'),
            ("location", "str", '"Seattle, WA"'),
            ("max_results", "int", "5"),
        ],
        item_class="LinkedinJob",
        item_fields=[("title", "str"), ("company", "str"), ("location", "str")],
        result_class="LinkedinSearchResult",
        result_fields=[("job_title", "str"), ("location", "str"),
                       ("jobs", "list[LinkedinJob]")],
        test_dates={},
    ),
    "lowes_com": dict(
        func_name="search_lowes_products",
        description="Searches Lowe's for products matching a query and returns up to max_results listings.",
        req_fields=[
            ("search_query", "str", '"cordless drill"'),
            ("max_results", "int", "5"),
        ],
        item_class="LowesProduct",
        item_fields=[("name", "str"), ("price", "str"), ("model_number", "str")],
        result_class="LowesSearchResult",
        result_fields=[("search_query", "str"), ("products", "list[LowesProduct]")],
        test_dates={},
    ),
    "maps_google_com": dict(
        func_name="get_google_maps_directions",
        description="Gets driving directions from an origin to a destination using Google Maps and returns route details.",
        req_fields=[
            ("origin", "str", '"Seattle, WA"'),
            ("destination", "str", '"Portland, OR"'),
        ],
        item_class="MapsRouteStep",
        item_fields=[("instruction", "str"), ("distance", "str"), ("duration", "str")],
        result_class="MapsDirectionsResult",
        result_fields=[("origin", "str"), ("destination", "str"),
                       ("total_distance", "str"), ("total_duration", "str"),
                       ("steps", "list[MapsRouteStep]")],
        test_dates={},
    ),
    "nike_com": dict(
        func_name="search_nike_products",
        description="Searches Nike for products matching a query and returns up to max_results listings.",
        req_fields=[
            ("search_query", "str", '"running shoes"'),
            ("max_results", "int", "5"),
        ],
        item_class="NikeProduct",
        item_fields=[("name", "str"), ("price", "str"), ("color", "str")],
        result_class="NikeSearchResult",
        result_fields=[("search_query", "str"), ("products", "list[NikeProduct]")],
        test_dates={},
    ),
    "nytimes_com": dict(
        func_name="extract_nytimes_headlines",
        description="Extracts top headlines from the New York Times homepage and returns up to max_results articles.",
        req_fields=[("max_results", "int", "5")],
        item_class="NytimesArticle",
        item_fields=[("title", "str"), ("section", "str"), ("url", "str")],
        result_class="NytimesResult",
        result_fields=[("articles", "list[NytimesArticle]")],
        test_dates={},
    ),
    "opentable_com": dict(
        func_name="search_opentable_restaurants",
        description="Searches OpenTable for available restaurants at a location and date and returns up to max_results.",
        req_fields=[
            ("location", "str", '"Chicago, IL"'),
            ("date", "date", None),
            ("party_size", "int", "2"),
            ("max_results", "int", "5"),
        ],
        item_class="OpentableRestaurant",
        item_fields=[("name", "str"), ("cuisine", "str"), ("rating", "str"),
                     ("available_times", "list[str]")],
        result_class="OpentableSearchResult",
        result_fields=[("location", "str"), ("date", "date"), ("party_size", "int"),
                       ("restaurants", "list[OpentableRestaurant]")],
        test_dates={"date": "today + relativedelta(months=2)"},
    ),
    "redfin_com": dict(
        func_name="search_redfin_homes",
        description="Searches Redfin for homes for sale in a location and returns up to max_results listings.",
        req_fields=[
            ("location", "str", '"Seattle, WA"'),
            ("max_results", "int", "5"),
        ],
        item_class="RedfinHome",
        item_fields=[("address", "str"), ("price", "str"), ("beds", "str"), ("sqft", "str")],
        result_class="RedfinSearchResult",
        result_fields=[("location", "str"), ("homes", "list[RedfinHome]")],
        test_dates={},
    ),
    "southwest_com": dict(
        func_name="search_southwest_flights",
        description="Searches Southwest Airlines for round-trip flights and returns up to max_results options.",
        req_fields=[
            ("origin", "str", '"Seattle"'),
            ("destination", "str", '"Las Vegas"'),
            ("departure_date", "date", None),
            ("return_date", "date", None),
            ("max_results", "int", "5"),
        ],
        item_class="SouthwestFlight",
        item_fields=[("departure_time", "str"), ("arrival_time", "str"),
                     ("price", "str"), ("stops", "str")],
        result_class="SouthwestSearchResult",
        result_fields=[("origin", "str"), ("destination", "str"),
                       ("departure_date", "date"), ("return_date", "date"),
                       ("flights", "list[SouthwestFlight]")],
        test_dates={"departure_date": "today + relativedelta(months=2)",
                    "return_date": "departure_date + timedelta(days=5)"},
    ),
    "spotify_com": dict(
        func_name="search_spotify_tracks",
        description="Searches Spotify for tracks or playlists matching a query and returns up to max_results.",
        req_fields=[
            ("search_query", "str", '"jazz piano"'),
            ("max_results", "int", "5"),
        ],
        item_class="SpotifyTrack",
        item_fields=[("title", "str"), ("artist", "str"), ("duration", "str")],
        result_class="SpotifySearchResult",
        result_fields=[("search_query", "str"), ("tracks", "list[SpotifyTrack]")],
        test_dates={},
    ),
    "stackoverflow_com": dict(
        func_name="search_stackoverflow",
        description="Searches Stack Overflow for questions and returns up to max_results results with answers.",
        req_fields=[
            ("query", "str", '"playwright python timeout"'),
            ("max_results", "int", "5"),
        ],
        item_class="StackOverflowQuestion",
        item_fields=[("title", "str"), ("url", "str"), ("score", "str"),
                     ("answer_count", "str")],
        result_class="StackOverflowResult",
        result_fields=[("query", "str"), ("questions", "list[StackOverflowQuestion]")],
        test_dates={},
    ),
    "target_com": dict(
        func_name="search_target_products",
        description="Searches Target for products matching a query and returns up to max_results listings.",
        req_fields=[
            ("search_query", "str", '"air fryer"'),
            ("max_results", "int", "5"),
        ],
        item_class="TargetProduct",
        item_fields=[("name", "str"), ("price", "str"), ("rating", "str")],
        result_class="TargetSearchResult",
        result_fields=[("search_query", "str"), ("products", "list[TargetProduct]")],
        test_dates={},
    ),
    "teams_microsoft_com": dict(
        func_name="send_teams_message",
        description="Sends a Microsoft Teams message to a recipient and returns True on success.",
        req_fields=[
            ("recipient", "str", '"johndoe@contoso.com"'),
            ("message", "str", '"Hello John"'),
        ],
        item_class=None,
        item_fields=[],
        result_class="TeamsSendResult",
        result_fields=[("success", "bool"), ("recipient", "str"), ("message", "str")],
        test_dates={},
    ),
    "ticketmaster_com": dict(
        func_name="search_ticketmaster_events",
        description="Searches Ticketmaster for events matching a query and returns up to max_results listings.",
        req_fields=[
            ("search_query", "str", '"Taylor Swift"'),
            ("location", "str", '"Seattle, WA"'),
            ("max_results", "int", "5"),
        ],
        item_class="TicketmasterEvent",
        item_fields=[("name", "str"), ("date", "str"), ("venue", "str"), ("price", "str")],
        result_class="TicketmasterSearchResult",
        result_fields=[("search_query", "str"), ("location", "str"),
                       ("events", "list[TicketmasterEvent]")],
        test_dates={},
    ),
    "trulia_com": dict(
        func_name="search_trulia_homes",
        description="Searches Trulia for homes for sale or rent in a location and returns up to max_results listings.",
        req_fields=[
            ("location", "str", '"Seattle, WA"'),
            ("max_results", "int", "5"),
        ],
        item_class="TruliaHome",
        item_fields=[("address", "str"), ("price", "str"), ("beds", "str"), ("sqft", "str")],
        result_class="TruliaSearchResult",
        result_fields=[("location", "str"), ("homes", "list[TruliaHome]")],
        test_dates={},
    ),
    "uber_com": dict(
        func_name="search_uber_rides",
        description="Searches Uber for available ride options between a pickup and dropoff and returns up to max_results.",
        req_fields=[
            ("pickup", "str", '"Seattle-Tacoma International Airport"'),
            ("dropoff", "str", '"Downtown Seattle"'),
            ("max_results", "int", "5"),
        ],
        item_class="UberRide",
        item_fields=[("ride_type", "str"), ("price_estimate", "str"),
                     ("wait_time", "str")],
        result_class="UberSearchResult",
        result_fields=[("pickup", "str"), ("dropoff", "str"),
                       ("rides", "list[UberRide]")],
        test_dates={},
    ),
    "ubereats_com": dict(
        func_name="search_ubereats_restaurants",
        description="Searches UberEats for restaurants in a location and returns up to max_results options.",
        req_fields=[
            ("address", "str", '"Chicago, IL 60601"'),
            ("cuisine", "str", '"pizza"'),
            ("max_results", "int", "5"),
        ],
        item_class="UberEatsRestaurant",
        item_fields=[("name", "str"), ("rating", "str"), ("delivery_fee", "str"),
                     ("delivery_time", "str")],
        result_class="UberEatsSearchResult",
        result_fields=[("address", "str"), ("cuisine", "str"),
                       ("restaurants", "list[UberEatsRestaurant]")],
        test_dates={},
    ),
    "udemy_com": dict(
        func_name="search_udemy_courses",
        description="Searches Udemy for courses matching a query and returns up to max_results listings.",
        req_fields=[
            ("search_query", "str", '"python programming"'),
            ("max_results", "int", "5"),
        ],
        item_class="UdemyCourse",
        item_fields=[("title", "str"), ("instructor", "str"), ("price", "str"), ("rating", "str")],
        result_class="UdemySearchResult",
        result_fields=[("search_query", "str"), ("courses", "list[UdemyCourse]")],
        test_dates={},
    ),
    "united_com": dict(
        func_name="search_united_flights",
        description="Searches United Airlines for round-trip flights and returns up to max_results options.",
        req_fields=[
            ("origin", "str", '"Seattle"'),
            ("destination", "str", '"Chicago"'),
            ("departure_date", "date", None),
            ("return_date", "date", None),
            ("max_results", "int", "5"),
        ],
        item_class="UnitedFlight",
        item_fields=[("departure_time", "str"), ("arrival_time", "str"),
                     ("price", "str"), ("duration", "str")],
        result_class="UnitedSearchResult",
        result_fields=[("origin", "str"), ("destination", "str"),
                       ("departure_date", "date"), ("return_date", "date"),
                       ("flights", "list[UnitedFlight]")],
        test_dates={"departure_date": "today + relativedelta(months=2)",
                    "return_date": "departure_date + timedelta(days=3)"},
    ),
    "usps_com": dict(
        func_name="lookup_usps_zip",
        description="Looks up USPS ZIP code information for a given address and returns location details.",
        req_fields=[
            ("address", "str", '"1600 Pennsylvania Ave NW, Washington DC"'),
        ],
        item_class=None,
        item_fields=[],
        result_class="UspsZipResult",
        result_fields=[("address", "str"), ("zip_code", "str"), ("city", "str"),
                       ("state", "str")],
        test_dates={},
    ),
    "walmart_com": dict(
        func_name="search_walmart_products",
        description="Searches Walmart for products matching a query and returns up to max_results listings.",
        req_fields=[
            ("search_query", "str", '"air fryer"'),
            ("max_results", "int", "5"),
        ],
        item_class="WalmartProduct",
        item_fields=[("name", "str"), ("price", "str"), ("rating", "str")],
        result_class="WalmartSearchResult",
        result_fields=[("search_query", "str"), ("products", "list[WalmartProduct]")],
        test_dates={},
    ),
    "weather_com": dict(
        func_name="get_weather_forecast",
        description="Gets the current weather forecast for a location from weather.com and returns conditions and temperature.",
        req_fields=[
            ("location", "str", '"Seattle, WA"'),
        ],
        item_class="WeatherDay",
        item_fields=[("date", "str"), ("condition", "str"), ("high", "str"), ("low", "str")],
        result_class="WeatherForecastResult",
        result_fields=[("location", "str"), ("current_temp", "str"),
                       ("current_condition", "str"), ("forecast", "list[WeatherDay]")],
        test_dates={},
    ),
    "webmd_com": dict(
        func_name="search_webmd_conditions",
        description="Searches WebMD for health conditions or symptoms and returns up to max_results articles.",
        req_fields=[
            ("search_term", "str", '"headache"'),
            ("max_results", "int", "5"),
        ],
        item_class="WebmdArticle",
        item_fields=[("title", "str"), ("url", "str"), ("summary", "str")],
        result_class="WebmdSearchResult",
        result_fields=[("search_term", "str"), ("articles", "list[WebmdArticle]")],
        test_dates={},
    ),
    "wikipedia_org": dict(
        func_name="search_wikipedia_article",
        description="Searches Wikipedia for an article and extracts its summary paragraph and key infobox facts.",
        req_fields=[
            ("search_term", "str", '"Space Needle"'),
        ],
        item_class=None,
        item_fields=[],
        result_class="WikipediaArticleResult",
        result_fields=[("title", "str"), ("summary", "str"), ("infobox", "dict[str, str]")],
        test_dates={},
    ),
    "youtube_com": dict(
        func_name="search_youtube_videos",
        description="Searches YouTube for videos matching a query and returns the top max_results results.",
        req_fields=[
            ("search_query", "str", '"anchorage museums"'),
            ("max_results", "int", "5"),
        ],
        item_class="YoutubeVideo",
        item_fields=[("title", "str"), ("url", "str"), ("duration", "str")],
        result_class="YoutubeSearchResult",
        result_fields=[("search_query", "str"), ("videos", "list[YoutubeVideo]")],
        test_dates={},
    ),
    "zillow_com": dict(
        func_name="search_zillow_homes",
        description="Searches Zillow for homes for sale in a location and returns up to max_results listings.",
        req_fields=[
            ("location", "str", '"Seattle, WA"'),
            ("max_results", "int", "5"),
        ],
        item_class="ZillowHome",
        item_fields=[("address", "str"), ("price", "str"), ("beds", "str"), ("sqft", "str")],
        result_class="ZillowSearchResult",
        result_fields=[("location", "str"), ("homes", "list[ZillowHome]")],
        test_dates={},
    ),
}


def type_annotation(type_str: str) -> str:
    """Return annotation string (same, but 'date' needs import)."""
    return type_str


def _default_or_none(default_str):
    return f" = {default_str}" if default_str is not None else ""


def generate_dataclasses(folder: str, meta: dict) -> str:
    """Generate @dataclass definitions for Request, Item, Result."""
    func_name = meta["func_name"]
    req_fields = meta["req_fields"]
    item_class = meta["item_class"]
    item_fields = meta["item_fields"]
    result_class = meta["result_class"]
    result_fields = meta["result_fields"]
    description = meta["description"]

    lines = []

    # Derive a Request class name
    req_class = result_class.replace("Result", "Request").replace("SearchResult", "Request")
    if req_class == result_class:
        req_class = result_class + "Request"

    # Request dataclass
    if req_fields:
        lines.append(f"@dataclass(frozen=True)")
        lines.append(f"class {req_class}:")
        for name, typ, default in req_fields:
            lines.append(f"    {name}: {typ}")
        lines.append("")
        lines.append("")

    # Item dataclass
    if item_class and item_fields:
        lines.append(f"@dataclass(frozen=True)")
        lines.append(f"class {item_class}:")
        for name, typ in item_fields:
            lines.append(f"    {name}: {typ}")
        lines.append("")
        lines.append("")

    # Result dataclass
    lines.append(f"@dataclass(frozen=True)")
    lines.append(f"class {result_class}:")
    for name, typ in result_fields:
        lines.append(f"    {name}: {typ}")
    lines.append("")
    lines.append("")

    return req_class, "\n".join(lines)


def generate_function_wrapper(folder: str, meta: dict, req_class: str,
                               original_src: str) -> str:
    """Generate the wrapper function that calls the original run() / main function."""
    func_name = meta["func_name"]
    req_fields = meta["req_fields"]
    result_class = meta["result_class"]
    item_class = meta["item_class"]
    item_fields = meta["item_fields"]
    description = meta["description"]

    lines = []
    lines.append(f"# {description}")

    if req_fields:
        lines.append(f"def {func_name}(")
        lines.append(f"    playwright,")
        lines.append(f"    request: {req_class},")
        lines.append(f") -> {result_class}:")
    else:
        lines.append(f"def {func_name}(")
        lines.append(f"    playwright,")
        lines.append(f") -> {result_class}:")

    # Build the call to run()
    req_names = [f[0] for f in req_fields]

    # Detect what the original main function is
    has_run = "def run(" in original_src or "def run\n" in original_src
    has_main = "def main(" in original_src
    has_clear_cart = "def clear_cart(" in original_src
    has_send = "def send_message(" in original_src or "def teams" in original_src

    if has_run:
        # Figure out which args run() takes
        import ast
        try:
            tree = ast.parse(original_src)
            run_args = []
            for n in ast.walk(tree):
                if isinstance(n, ast.FunctionDef) and n.name == "run":
                    run_args = [a.arg for a in n.args.args]
                    break
        except Exception:
            run_args = []

        if not run_args:
            call_args = "playwright"
        else:
            call_parts = []
            for arg in run_args:
                if arg == "playwright":
                    call_parts.append("playwright")
                elif arg in req_names:
                    call_parts.append(f"request.{arg}")
                else:
                    # skip, will use default
                    pass
            call_args = ", ".join(call_parts)

        lines.append(f"    raw = run({call_args})")
    elif has_clear_cart:
        lines.append(f"    success = clear_cart(playwright)")
        lines.append(f"    return {result_class}(success=success)")
        lines.append("")
        return "\n".join(lines)
    elif has_main or (not has_run):
        # Wrap main() or inline
        lines.append(f"    # NOTE: original script uses main(); call it and adapt result")
        lines.append(f"    raw = []")
    else:
        lines.append(f"    raw = run(playwright)")

    # Build return
    if result_class == "AmazonClearCartResult":
        lines.append(f"    return {result_class}(success=bool(raw))")
    elif result_class == "TeamsSendResult":
        req_names_str = ", ".join(f"request.{n}" for n in req_names)
        lines.append(f"    success = run({', '.join(['playwright'] + [f'request.{n}' for n in req_names])})")
        lines.append(f"    return {result_class}(success=success, recipient=request.recipient, message=request.message)")
        lines.append("")
        return "\n".join(lines)
    elif item_class:
        collection_field = [f[0] for f in meta["result_fields"] if "list" in f[1]]
        coll_name = collection_field[0] if collection_field else "items"
        scalar_fields = [(f[0], f[1]) for f in meta["result_fields"] if "list" not in f[1]]

        item_conversions = []
        for name, typ in item_fields:
            item_conversions.append(f'            {name}=r.get("{name}", "N/A") if isinstance(r, dict) else getattr(r, "{name}", "N/A"),')

        lines.append(f"    {coll_name} = [")
        lines.append(f"        {item_class}(")
        for line in item_conversions:
            lines.append(line)
        lines.append(f"        )")
        lines.append(f"        for r in (raw if isinstance(raw, list) else [])")
        lines.append(f"    ]")

        # Build result constructor
        result_args = []
        for fname, ftype in meta["result_fields"]:
            if "list" in ftype:
                result_args.append(f"{fname}={coll_name}")
            elif fname in req_names:
                result_args.append(f"{fname}=request.{fname}")
            else:
                result_args.append(f'{fname}=""')
        lines.append(f"    return {result_class}(")
        for arg in result_args:
            lines.append(f"        {arg},")
        lines.append(f"    )")
    else:
        # dict-returning functions
        lines.append(f"    if isinstance(raw, dict):")
        result_args = []
        for fname, ftype in meta["result_fields"]:
            if fname in req_names:
                result_args.append(f"{fname}=request.{fname}")
            elif ftype == "str":
                result_args.append(f'{fname}=raw.get("{fname}", "")')
            elif ftype.startswith("dict"):
                result_args.append(f'{fname}=raw.get("{fname}", {{}})')
            elif ftype.startswith("list"):
                result_args.append(f'{fname}=raw.get("{fname}", [])')
            else:
                result_args.append(f'{fname}=raw.get("{fname}", "")')
        lines.append(f"        return {result_class}(")
        for arg in result_args:
            lines.append(f"            {arg},")
        lines.append(f"        )")
        lines.append(f"    return {result_class}(")
        for arg in result_args:
            lines.append(f"        {arg},")
        lines.append(f"    )")

    lines.append("")
    return "\n".join(lines)


def generate_test(folder: str, meta: dict, req_class: str) -> str:
    """Generate the test function with date calculations in test code."""
    func_name = meta["func_name"]
    req_fields = meta["req_fields"]
    result_class = meta["result_class"]
    item_class = meta["item_class"]
    test_dates = meta["test_dates"]

    lines = []
    lines.append(f"def test_{func_name}() -> None:")
    lines.append(f"    today = date.today()")

    # Compute date fields in order (some depend on others)
    date_field_names = [f[0] for f in req_fields if f[1] == "date"]
    for fname in date_field_names:
        expr = test_dates.get(fname, f"today + relativedelta(months=2)")
        lines.append(f"    {fname} = {expr}")

    if not req_fields:
        lines.append(f"")
        lines.append(f"    with sync_playwright() as pw:")
        lines.append(f"        result = {func_name}(pw)")
    else:
        lines.append(f"")
        lines.append(f"    request = {req_class}(")
        for fname, ftype, default in req_fields:
            if ftype == "date":
                lines.append(f"        {fname}={fname},")
            elif default is not None:
                lines.append(f"        {fname}={default},")
            else:
                lines.append(f"        {fname}=None,  # TODO: provide value")
        lines.append(f"    )")
        lines.append(f"")
        lines.append(f"    with sync_playwright() as pw:")
        lines.append(f"        result = {func_name}(pw, request)")

    lines.append(f"")
    lines.append(f"    assert isinstance(result, {result_class})")

    # Assertions for item lists
    if item_class:
        collection_field = [f[0] for f in meta["result_fields"] if "list" in f[1]]
        if collection_field:
            coll = collection_field[0]
            max_f = [f for f in req_fields if f[0] == "max_results"]
            if max_f:
                lines.append(f"    assert len(result.{coll}) <= request.max_results")
            else:
                lines.append(f"    assert isinstance(result.{coll}, list)")
            lines.append(f"    print(f'\\nFound {{len(result.{coll})}} {coll}')")
            lines.append(f"    for i, item in enumerate(result.{coll}, 1):")
            first_field = item_fields[0][0] if (item_fields := meta["item_fields"]) else "title"
            lines.append(f"        print(f'  {{i}}. {{item.{first_field}}}')")

    lines.append(f"")
    lines.append(f"")

    return "\n".join(lines)


def generate_signature_txt(folder: str, meta: dict, req_class: str) -> str:
    """Generate contents of signature.txt."""
    func_name = meta["func_name"]
    req_fields = meta["req_fields"]
    item_class = meta["item_class"]
    item_fields = meta["item_fields"]
    result_class = meta["result_class"]
    result_fields = meta["result_fields"]
    description = meta["description"]

    lines = []
    lines.append(f"# {description}")
    lines.append("")

    if req_fields:
        req_class_line = req_class
        lines.append(f"@dataclass(frozen=True)")
        lines.append(f"class {req_class_line}:")
        for fname, ftype, _ in req_fields:
            lines.append(f"    {fname}: {ftype}")
        lines.append("")

    if item_class and item_fields:
        lines.append(f"@dataclass(frozen=True)")
        lines.append(f"class {item_class}:")
        for fname, ftype in item_fields:
            lines.append(f"    {fname}: {ftype}")
        lines.append("")

    lines.append(f"@dataclass(frozen=True)")
    lines.append(f"class {result_class}:")
    for fname, ftype in result_fields:
        lines.append(f"    {fname}: {ftype}")
    lines.append("")

    if req_fields:
        lines.append(f"def {func_name}(playwright, request: {req_class}) -> {result_class}")
    else:
        lines.append(f"def {func_name}(playwright) -> {result_class}")

    return "\n".join(lines)


def needs_date_import(meta: dict) -> bool:
    return any(f[1] == "date" for f in meta["req_fields"])


def needs_relativedelta(meta: dict) -> bool:
    return any("relativedelta" in v for v in meta["test_dates"].values())


def process_folder(folder_path: Path, meta: dict) -> bool:
    folder = folder_path.name
    func_name = meta["func_name"]

    # Find primary .py file
    py_files = sorted([f for f in folder_path.glob("*.py")
                       if not f.name.startswith("_") and not f.name.endswith(".backup.py")])
    if not py_files:
        print(f"  SKIP {folder}: no .py files")
        return False

    # Prefer *_search.py or main task file
    primary = py_files[0]
    for f in py_files:
        if any(x in f.name for x in ["search", "directions", "locator", "news", "clear_cart",
                                      "send_message", "forecast", "lookup", "article"]):
            primary = f
            break

    original_src = primary.read_text(encoding="utf-8")

    req_class, dataclass_code = generate_dataclasses(folder, meta)
    func_code = generate_function_wrapper(folder, meta, req_class, original_src)
    test_code = generate_test(folder, meta, req_class)
    sig_txt = generate_signature_txt(folder, meta, req_class)

    # Build imports header
    needs_date = needs_date_import(meta) or any("date" in f[1] for f in meta["result_fields"])
    needs_rel = needs_relativedelta(meta)
    needs_timedelta = any("timedelta" in v for v in meta["test_dates"].values())

    has_playwright_import = "from playwright.sync_api import" in original_src
    has_sync_playwright = "sync_playwright" in original_src

    import_lines = []
    if "import re" not in original_src:
        import_lines.append("import re")
    if "import os" not in original_src:
        import_lines.append("import os")

    # We'll prepend dataclasses import to the original file  
    # Strategy: insert our new code AFTER the original imports / before the original function bodies

    # Find where to inject: after the last top-level import line
    src_lines = original_src.split("\n")
    last_import_idx = 0
    in_docstring = False
    for i, line in enumerate(src_lines):
        stripped = line.strip()
        if stripped.startswith('"""') or stripped.startswith("'''"):
            in_docstring = not in_docstring
            continue
        if in_docstring:
            continue
        if stripped.startswith(("import ", "from ", "sys.path")):
            last_import_idx = i

    # Build the injection block
    inject = []
    inject.append("")
    if "from dataclasses import dataclass" not in original_src:
        inject.append("from dataclasses import dataclass")
    if needs_date and "from datetime import" not in original_src:
        inject.append("from datetime import date, timedelta")
    elif needs_timedelta and "timedelta" not in original_src:
        inject.append("from datetime import timedelta")
    if needs_date and "from datetime import date" not in original_src and "from datetime import" in original_src:
        # Already has datetime import; patch it
        pass
    if needs_rel and "from dateutil.relativedelta import relativedelta" not in original_src:
        inject.append("from dateutil.relativedelta import relativedelta")
    if not has_sync_playwright and "sync_playwright" not in original_src:
        inject.append("from playwright.sync_api import sync_playwright")
    inject.append("")

    new_src = "\n".join(src_lines[:last_import_idx + 1])
    new_src += "\n" + "\n".join(inject) + "\n"
    new_src += "\n".join(src_lines[last_import_idx + 1:])

    # Append our new code at the end
    new_src += "\n\n"
    new_src += dataclass_code
    new_src += "\n"
    new_src += func_code
    new_src += "\n\n"
    new_src += test_code

    # Replace or add the __main__ block
    if 'if __name__ == "__main__"' in new_src:
        # Replace the existing main block
        import re
        new_src = re.sub(
            r'if __name__ == ["\'"]__main__["\'"].*',
            f'if __name__ == "__main__":\n    test_{func_name}()',
            new_src,
            flags=re.DOTALL,
        )
    else:
        new_src += f'\nif __name__ == "__main__":\n    test_{func_name}()\n'

    primary.write_text(new_src, encoding="utf-8")
    (folder_path / "signature.txt").write_text(sig_txt, encoding="utf-8")
    print(f"  OK  {folder}: {primary.name}  +  signature.txt")
    return True


def main():
    ok = 0
    skip = 0
    errors = []
    for folder_name, meta in FOLDER_META.items():
        folder_path = VERBS_DIR / folder_name
        if not folder_path.is_dir():
            print(f"  MISS {folder_name}: directory not found")
            skip += 1
            continue
        if (folder_path / "signature.txt").exists():
            print(f"  DONE {folder_name}: already has signature.txt, skipping")
            skip += 1
            continue
        try:
            if process_folder(folder_path, meta):
                ok += 1
            else:
                skip += 1
        except Exception as e:
            import traceback
            print(f"  ERR  {folder_name}: {e}")
            traceback.print_exc()
            errors.append(folder_name)

    print(f"\n{'='*50}")
    print(f"Done: {ok}  Skipped: {skip}  Errors: {len(errors)}")
    if errors:
        print(f"Errored: {errors}")


if __name__ == "__main__":
    main()
