import json
import os
import tempfile

os.environ["DATABASE_PATH"] = os.path.join(tempfile.mkdtemp(), "test.sqlite3")

from fastapi.testclient import TestClient  # noqa: E402

from main import app  # noqa: E402
from app.database.db import connect, init_db  # noqa: E402
from tests.test_governance_metrics import POSTS  # noqa: E402

init_db()
client = TestClient(app)


def register(name, email, workspace_id=None):
    r = client.post("/api/auth/register", json={"full_name": name, "email": email, "password": "password123",
                                                "workspace_id": workspace_id})
    assert r.status_code == 200, r.text
    return r.json()


def test_end_to_end_insights_and_team_management():
    owner = register("Owner One", "owner@test.dev")
    ws = owner["user"]["workspaceId"]
    emp = register("Emp One", "emp@test.dev", ws)
    oh = {"Authorization": f"Bearer {owner['token']}"}
    eh = {"Authorization": f"Bearer {emp['token']}"}

    # team management
    r = client.patch(f"/api/workspace/members/{emp['user']['id']}", json={"department": "Marketing"}, headers=oh)
    assert r.status_code == 200 and r.json()["department"] == "Marketing"
    assert client.patch(f"/api/workspace/members/{owner['user']['id']}", json={"department": "X"}, headers=eh).status_code == 403

    posts = [dict(p, creatorId=emp["user"]["id"]) for p in POSTS]
    with connect() as db:
        db.execute("INSERT INTO workspace_data VALUES(?,?,?,?)", (ws, "posts", json.dumps(posts), "now"))

    data = client.get("/api/analytics/governance", headers=oh).json()
    assert data["postsInScope"] == 3
    assert data["errorRateByTeam"][0]["team"] == "Marketing"
    assert data["mostViolatedRules"][0]["rule"] == "Terminology §2.1"

    csv = client.get("/api/analytics/governance.csv", headers=oh)
    assert csv.status_code == 200 and "Most violated rules" in csv.text
    assert client.get("/api/analytics/governance.csv", headers=eh).status_code == 403
