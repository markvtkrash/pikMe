"""A stand-in for the Supabase backend, used by the customer app's browser tests (Playwright). It answers the app's calls with made-up data, so the real
screens run in a real browser without a login and without touching the real database. The app is also given a fake signed-in session.

Every Supabase-style request is answered by the mock, whatever host the app was configured with, and is never forwarded to a real server. Everything else
that is not the app itself (localhost) is refused and recorded.
"""

import base64
import json
import re
import time
from urllib.parse import urlparse

MOCK_ORIGIN = "http://localhost:9199"
# The key the Supabase client stores the session under: "sb-<first part of the host name>-auth-token".
SESSION_KEY = "sb-localhost-auth-token"

CORS = {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "*",
    "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "access-control-expose-headers": "*",
}


def _b64(data: dict) -> str:
    return base64.urlsafe_b64encode(json.dumps(data).encode()).decode().rstrip("=")


def fake_session() -> dict:
    """A signed-in session that does not expire during the test (a real-looking JWT; nothing checks its signature)."""
    now = int(time.time())
    exp = now + 60 * 60 * 24 * 365
    token = ".".join([_b64({"alg": "HS256", "typ": "JWT"}), _b64({"sub": "00000000-0000-0000-0000-0000000000aa", "role": "authenticated", "exp": exp}), "sig"])
    return {
        "access_token": token, "refresh_token": "test-refresh", "token_type": "bearer", "expires_in": 31536000, "expires_at": exp,
        "user": {"id": "00000000-0000-0000-0000-0000000000aa", "aud": "authenticated", "role": "authenticated", "email": "tester@example.com",
                 "app_metadata": {}, "user_metadata": {}, "created_at": "2026-01-01T00:00:00Z"},
    }


PROFILE_PLAIN = {
    "id": "00000000-0000-0000-0000-0000000000aa", "displayName": "Tester", "searchRadiusMeters": 2000, "onboardingComplete": True,
    "dietaryRestrictions": [], "healthGoals": ["balanced"], "allergens": [], "cuisinePreferences": ["italian"], "nutritionTargets": {},
}
PROFILE_DIET = dict(PROFILE_PLAIN, dietaryRestrictions=["vegetarian"], allergens=["peanut"])


def restaurants():
    names = [
        "Bella Notte Ristorante Italiano & Wine Bar of Downtown", "Taco Loco", "The Extraordinarily Long Named Burger and Shake Emporium",
        "Sushi Zen", "Pho 88", "Green Leaf Cafe", "Smokehouse BBQ Co.", "Mediterranean Breeze Grill & Kebab House",
    ]
    out = []
    for i, name in enumerate(names):
        out.append({
            "placeId": f"ChIJmockplace{i:010d}", "name": name,
            "location": {"latitude": 37.77 + i * 0.001, "longitude": -122.41, "address": f"{100 + i} Market Street Suite {i}, San Francisco, CA 94103, USA", "city": "San Francisco"},
            "distanceMeters": 400 + i * 300, "rating": 4.1 + (i % 8) / 10, "cuisineTypes": ["restaurant", "food", "italian"],
            "openNow": i % 2 == 0, "hasNutritionData": True,
        })
    return out


def menu_rows(restaurant_name: str):
    items = [
        ("Grilled Chicken Salad", True), ("Classic Cheeseburger with Extra Cheese and Special Sauce on a Brioche Bun", True),
        ("Mexican Rice", False), ("Veggie Wrap", True), ("Spaghetti Bolognese", True), ("Chocolate Lava Cake", False),
        ("Caesar Salad", True), ("Grilled Salmon with Lemon Butter and Seasonal Vegetables", True), ("Margherita Pizza", True),
        ("French Onion Soup", False), ("Buffalo Wings (12 pieces)", True), ("Garden Salad", True),
        ("Supercalifragilisticexpialidocious Mega Combo Platter Deluxe", True), ("Iced Latte", False),
    ]
    rows = []
    for i, (name, verified) in enumerate(items):
        rows.append({
            "item_id": f"mock-item-{i:03d}", "name": name, "restaurant_name": restaurant_name, "calories": 280 + i * 35, "total_fat_g": 8 + i,
            "saturated_fat_g": 2 + (i % 4), "sodium_mg": 400 + i * 40, "total_carbs_g": 20 + i * 2, "protein_g": 12 + i, "serving_weight_grams": 250,
            "is_verified": verified, "nutrition_source": "ai_estimate", "dietary_fiber_g": 3, "sugars_g": 5,
        })
    return rows


def coupons():
    return [
        {"id": "coupon-1", "menu_item_id": "mock-item-000", "coupon_code": "SAVE20", "coupon_type": "percent", "discount_value": 20,
         "per_user_limit": 3, "user_uses_count": 1, "usage_limit": 50, "times_used": 47, "activated_at": None},
        {"id": "coupon-2", "menu_item_id": None, "coupon_code": "WELCOME5", "coupon_type": "fixed", "discount_value": 5,
         "per_user_limit": 1, "user_uses_count": 0, "usage_limit": None, "times_used": 0, "activated_at": None},
    ]


class MockBackend:
    def __init__(self, diet: bool = False):
        self.profile = PROFILE_DIET if diet else PROFILE_PLAIN
        self.calls = []
        self.blocked = []
        self.seen = []
        self.restaurants = restaurants()

    def rpc(self, name, body):
        if name == "get_user_profile":
            return self.profile
        if name == "get_saved_items":
            return {"restaurants": [], "menuItems": []}
        if name == "get_customer_config":
            return {"maxRadiusMiles": "6", "showUnconfirmedMenuItems": "true", "minAppVersion": "0.0.0", "announcements": [], "categories": []}
        if name == "get_menu_items_for_restaurant":
            return menu_rows(body.get("p_restaurant_name", "Test"))
        if name == "is_franchise_chain":
            return False
        if name == "get_active_coupons_for_restaurant":
            return coupons()
        if name == "get_place_ids_with_active_coupons":
            return []
        if name == "get_item_analysis":
            return None
        return None

    def function(self, name, body):
        if name == "fetch-nearby-restaurants":
            return self.restaurants
        if name == "ai-item-analysis":
            return {"analysis": "Yes, this looks like a reasonable fit for your goals based on its estimated calories and protein."}
        if name in ("fetch-menu-items-ai", "fetch-menu-items"):
            return []
        return {}

    def _handle(self, route):
        request = route.request
        if request.method == "OPTIONS":
            # a wildcard does not cover the Authorization header, so echo back whatever headers the request asks to send
            asked = request.headers.get("access-control-request-headers", "*")
            route.fulfill(status=204, headers={**CORS, "access-control-allow-headers": asked})
            return
        path = urlparse(request.url).path
        try:
            body = json.loads(request.post_data or "{}")
        except ValueError:
            body = {}
        headers = {**CORS, "content-type": "application/json"}
        m = re.match(r"^/rest/v1/rpc/([A-Za-z0-9_]+)$", path)
        if m:
            self.calls.append(("rpc:" + m.group(1), body))
            route.fulfill(status=200, headers=headers, body=json.dumps(self.rpc(m.group(1), body)))
            return
        m = re.match(r"^/functions/v1/([A-Za-z0-9_-]+)$", path)
        if m:
            self.calls.append(("fn:" + m.group(1), body))
            route.fulfill(status=200, headers=headers, body=json.dumps(self.function(m.group(1), body)))
            return
        if path.startswith("/auth/v1/"):
            session = fake_session()
            if path.endswith("/user"):
                route.fulfill(status=200, headers=headers, body=json.dumps(session["user"]))
            else:
                route.fulfill(status=200, headers=headers, body=json.dumps(session))
            return
        if path == "/rest/v1/restaurants":
            # the menu screen looks up the restaurant row by its place id before it asks for coupons
            self.calls.append(("table:restaurants", body))
            route.fulfill(status=200, headers=headers, body=json.dumps([{"id": "mock-restaurant-id"}]))
            return
        self.calls.append(("other:" + path, body))
        route.fulfill(status=200, headers=headers, body="[]")

    def _dispatch(self, route):
        """Every Supabase-style request (/rest/v1, /auth/v1, /functions/v1) is answered by the mock, whatever host the app was configured with, and is never
        forwarded. The app itself (localhost) is let through. Anything else is refused and recorded."""
        url = route.request.url
        parsed = urlparse(url)
        self.seen.append(url)
        if re.match(r"^/(rest|auth|functions)/v1/", parsed.path):
            self._handle(route)
        elif parsed.netloc.startswith("localhost:") or parsed.netloc.startswith("127.0.0.1:"):
            route.continue_()
        else:
            self.blocked.append(url)
            route.abort()

    def install(self, context, signed_in: bool = True):
        context.route("**/*", self._dispatch)
        if signed_in:
            # whichever host name the app's Supabase client uses, its stored session is this fake one
            session = json.dumps(json.dumps(fake_session()))
            context.add_init_script(
                "(() => { const get = Storage.prototype.getItem; "
                "Storage.prototype.getItem = function (k) { return /^sb-.+-auth-token$/.test(k) ? " + session + " : get.call(this, k); }; })();"
            )

    def touched_a_backend(self):
        """Always empty by design: backend-style requests are answered by the mock. Kept so a test can still assert it."""
        return [u for u in self.blocked if any(part in u for part in ("/rest/v1/", "/auth/v1/", "/functions/v1/"))]

    def unknown_calls(self):
        return sorted({n for (n, _b) in self.calls if n.startswith("other:")})
