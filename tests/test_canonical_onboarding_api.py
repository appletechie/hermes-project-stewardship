from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from hermes_project_stewardship.api.server import create_app
from hermes_project_stewardship.kanban import KanbanAdapterError
from hermes_project_stewardship.kanban.bridge import BoardCard, KanbanAdapter
from hermes_project_stewardship.persistence.dockyard_service import DockyardService
from hermes_project_stewardship.persistence.service import StewardshipService
from hermes_project_stewardship.persistence.store import Store


class ProvisioningAdapter(KanbanAdapter):
    def __init__(self, store: Store, *, fail: bool = False) -> None:
        self.store = store
        self.fail = fail
        self.calls: list[dict] = []
        self.by_key: dict[str, dict] = {}

    def ensure_board(self, project_id: str, slug: str) -> str:
        return slug

    def add_card(self, board_id: str, card: BoardCard) -> str:
        raise AssertionError("not used")

    def move_card(self, board_id: str, card_id: str, column: str) -> None:
        raise AssertionError("not used")

    def list_profiles(self) -> list[dict]:
        return [
            {"name": "default", "is_default": True},
            {"name": "octacon", "is_default": False},
        ]

    def validate_project(self, **payload):
        if self.fail:
            raise KanbanAdapterError(
                "validation_error",
                "Project details are invalid",
                fields={"repo_path": ["Repository path does not exist"]},
            )
        return dict(payload)

    def provision_project(self, **payload):
        self.calls.append(dict(payload))
        key = payload["idempotency_key"]
        if key in self.by_key:
            return {**self.by_key[key], "replayed": True}
        assert self.store._conn.execute(
            "SELECT COUNT(*) AS n FROM project_stewardship"
        ).fetchone()["n"] == 0
        if self.fail:
            raise KanbanAdapterError(
                "validation_error",
                "Project details are invalid",
                fields={"repo_path": ["Repository path does not exist"]},
            )
        result = {
            "status": "complete",
            "idempotency_key": key,
            "replayed": False,
            "project": {
                "id": "p_native_alpha",
                "slug": payload["slug"],
                "name": payload["name"],
                "board_slug": payload["board_slug"],
            },
            "board": {
                "slug": payload["board_slug"],
                "project_id": "p_native_alpha",
            },
        }
        self.by_key[key] = result
        return result

    def create_work(self, *args, **kwargs):
        raise AssertionError("not used")

    def list_work(self, *args, **kwargs):
        return []

    def get_work(self, *args, **kwargs):
        raise ValueError("not found")

    def transition_work(self, *args, **kwargs):
        raise AssertionError("not used")


def _payload(repo: Path) -> dict:
    return {
        "project_id": "alpha",
        "name": "Alpha Project",
        "slug": "alpha",
        "repo_path": str(repo),
        "mission": "Deliver Alpha safely",
        "lead_profile": "octacon",
        "board_slug": "alpha",
        "idempotency_key": "dockyard-onboard-alpha",
        "autonomy_level": 2,
        "actor_id": "sahil",
    }


def test_onboarding_provisions_canonical_project_before_governance_and_replays(tmp_path):
    repo = tmp_path / "alpha"
    repo.mkdir()
    store = Store(tmp_path / "dockyard.db")
    adapter = ProvisioningAdapter(store)
    app = create_app(store, kanban_adapter=adapter)
    client = TestClient(app)

    first = client.post("/stewardship/v1/onboard", json=_payload(repo))
    assert first.status_code == 200, first.text
    assert first.json()["canonical"]["project"]["id"] == "p_native_alpha"
    assert first.json()["canonical"]["board"]["slug"] == "alpha"
    assert adapter.calls[0]["repo_path"] == str(repo)

    settings = client.get("/stewardship/v1/projects/alpha/settings")
    assert settings.status_code == 200
    assert settings.json()["owner"]["lead_profile"] == "octacon"
    groups = client.get("/stewardship/v1/bot-groups").json()["groups"]
    assert any(group["name"] == "alpha-ops" for group in groups)
    views = client.get(
        "/stewardship/v1/projects/alpha/views",
        params={"actor_id": "sahil"},
    ).json()["views"]
    assert any(view["name"] == "Default board" for view in views)

    replay = client.post("/stewardship/v1/onboard", json=_payload(repo))
    assert replay.status_code == 200, replay.text
    assert replay.json() == first.json()
    assert store._conn.execute(
        "SELECT COUNT(*) AS n FROM project_stewardship WHERE project_id='alpha'"
    ).fetchone()["n"] == 1
    store.close()


def test_onboarding_preserves_host_field_errors_and_writes_no_governance(tmp_path):
    repo = tmp_path / "missing"
    store = Store(tmp_path / "dockyard.db")
    adapter = ProvisioningAdapter(store, fail=True)
    response = TestClient(create_app(store, kanban_adapter=adapter)).post(
        "/stewardship/v1/onboard",
        json=_payload(repo),
    )

    assert response.status_code == 422
    assert response.json() == {
        "error": {
            "code": "validation_error",
            "message": "Project details are invalid",
            "fields": {"repo_path": ["Repository path does not exist"]},
        }
    }
    assert store._conn.execute(
        "SELECT COUNT(*) AS n FROM project_stewardship"
    ).fetchone()["n"] == 0
    store.close()


def test_onboarding_retry_finishes_governance_after_local_failure(tmp_path, monkeypatch):
    repo = tmp_path / "recover"
    repo.mkdir()
    store = Store(tmp_path / "dockyard.db")
    adapter = ProvisioningAdapter(store)
    client = TestClient(create_app(store, kanban_adapter=adapter))
    original = DockyardService.group_create
    attempts = {"count": 0}

    def fail_once(self, *args, **kwargs):
        attempts["count"] += 1
        if attempts["count"] == 1:
            raise RuntimeError("raw local failure")
        return original(self, *args, **kwargs)

    monkeypatch.setattr(DockyardService, "group_create", fail_once)
    first = client.post("/stewardship/v1/onboard", json=_payload(repo))
    assert first.status_code == 409
    assert "raw local failure" not in first.text
    assert len(adapter.by_key) == 1

    replay = client.post("/stewardship/v1/onboard", json=_payload(repo))
    assert replay.status_code == 200, replay.text
    assert replay.json()["canonical"]["replayed"] is True
    store.close()


def test_onboarding_success_receipt_failure_preserves_binding_and_resumes(tmp_path, monkeypatch):
    repo = tmp_path / "receipt"
    repo.mkdir()
    store = Store(tmp_path / "dockyard.db")
    adapter = ProvisioningAdapter(store)
    client = TestClient(
        create_app(store, kanban_adapter=adapter), raise_server_exceptions=False
    )
    payload = _payload(repo)
    original_audit = store.audit

    def fail_receipt(*args, **kwargs):
        if kwargs.get("action") == "project.onboarded":
            raise RuntimeError("injected final receipt failure")
        return original_audit(*args, **kwargs)

    monkeypatch.setattr(store, "audit", fail_receipt)
    first = client.post("/stewardship/v1/onboard", json=payload)
    assert first.status_code == 500
    bound = store._conn.execute(
        "SELECT state, local_applied_revision FROM onboarding_operations"
        " WHERE idempotency_key=?",
        (payload["idempotency_key"],),
    ).fetchone()
    assert dict(bound) == {"state": "incomplete", "local_applied_revision": 1}

    monkeypatch.setattr(store, "audit", original_audit)
    retry = client.post("/stewardship/v1/onboard", json=payload)
    assert retry.status_code == 200, retry.text
    changed = client.post(
        "/stewardship/v1/onboard", json={**payload, "member_profiles": ["default"]}
    )
    assert changed.status_code == 409
    assert changed.json()["error"]["code"] == "idempotency_conflict"
    store.close()


def test_onboarding_rejects_real_membership_change_between_host_and_local_write(
    tmp_path, monkeypatch
):
    repo = tmp_path / "race"
    repo.mkdir()
    store = Store(tmp_path / "dockyard.db")
    adapter = ProvisioningAdapter(store)
    client = TestClient(create_app(store, kanban_adapter=adapter))
    original = adapter.provision_project
    competitor_errors: list[Exception] = []

    def provision_then_compete(**kwargs):
        result = original(**kwargs)
        try:
            StewardshipService(store).enable(
                "alpha", mission="competitor", lead_profile="default",
                member_profiles=["octacon"],
            )
        except Exception as exc:
            competitor_errors.append(exc)
        return result

    monkeypatch.setattr(adapter, "provision_project", provision_then_compete)
    response = client.post("/stewardship/v1/onboard", json=_payload(repo))
    assert competitor_errors == []
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "stale_preflight"
    assert StewardshipService(store).settings("alpha")["owner"] == {
        "lead_profile": "default",
        "member_profiles": ["octacon"],
        "owner_team_id": None,
    }
    operation = store._conn.execute(
        "SELECT state, local_applied_revision FROM onboarding_operations"
        " WHERE idempotency_key='dockyard-onboard-alpha'"
    ).fetchone()
    assert dict(operation) == {"state": "incomplete", "local_applied_revision": None}
    assert "dockyard-onboard-alpha" in adapter.by_key
    store.close()


# ---- bind-only onboarding: existing boards only, never a new one -----------


class BoardsAdapter(ProvisioningAdapter):
    def __init__(self, store: Store, boards: dict) -> None:
        super().__init__(store)
        self.boards = boards

    def get_board(self, slug: str) -> dict:
        if slug not in self.boards:
            raise KanbanAdapterError("board_not_found", "canonical board was not found")
        return {"slug": slug, **self.boards[slug]}


def _bind_only(tmp_path, monkeypatch, boards, *, env=True, **overrides):
    repo = tmp_path / "alpha"
    repo.mkdir()
    if env:
        monkeypatch.setenv("STEWARD_ONBOARD_BIND_ONLY", "1")
    store = Store(tmp_path / "dockyard.db")
    adapter = BoardsAdapter(store, boards)
    client = TestClient(create_app(store, kanban_adapter=adapter))
    response = client.post("/stewardship/v1/onboard", json={**_payload(repo), **overrides})
    enabled = store._conn.execute("SELECT COUNT(*) AS n FROM project_stewardship").fetchone()["n"]
    store.close()
    return response, adapter, enabled


def test_bind_only_onboarding_refuses_a_board_that_does_not_exist(tmp_path, monkeypatch):
    """The fleet onboards projects onto boards it already has; onboarding must
    never provision a new board there (it replaced upstream's route to stop it)."""
    response, adapter, enabled = _bind_only(tmp_path, monkeypatch, {})

    assert response.status_code == 422, response.text
    assert response.json()["error"]["code"] == "board_not_found"
    assert "binds existing boards only" in response.json()["error"]["message"]
    assert adapter.calls == [] and enabled == 0


def test_a_request_can_ask_for_bind_only_onboarding(tmp_path, monkeypatch):
    response, adapter, enabled = _bind_only(
        tmp_path, monkeypatch, {}, env=False, create_board=False)

    assert response.status_code == 422, response.text
    assert response.json()["error"]["code"] == "board_not_found"
    assert adapter.calls == [] and enabled == 0


def test_bind_only_onboarding_binds_an_existing_unbound_board(tmp_path, monkeypatch):
    response, adapter, enabled = _bind_only(tmp_path, monkeypatch, {"alpha": {}})

    assert response.status_code == 200, response.text
    assert response.json()["canonical"]["board"]["slug"] == "alpha"
    assert len(adapter.calls) == 1 and enabled == 1


@pytest.mark.parametrize("board", [{"project_id": "p_someone_else"}, {"archived": True}])
def test_bind_only_onboarding_refuses_a_board_it_cannot_take(tmp_path, monkeypatch, board):
    response, adapter, enabled = _bind_only(tmp_path, monkeypatch, {"alpha": board})

    assert response.status_code == 409, response.text
    assert adapter.calls == [] and enabled == 0
