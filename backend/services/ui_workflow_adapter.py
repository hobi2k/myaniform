from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any


def _normalize_links(links: list[Any]) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    for link in links:
        if isinstance(link, dict):
            normalized.append(dict(link))
            continue
        normalized.append(
            {
                "id": link[0],
                "origin_id": link[1],
                "origin_slot": link[2],
                "target_id": link[3],
                "target_slot": link[4],
                "type": link[5] if len(link) > 5 else None,
            }
        )
    return normalized


def _value_matches_input_type(value: Any, input_type: str | None) -> bool:
    if input_type == "INT":
        return isinstance(value, int) and not isinstance(value, bool)
    if input_type == "FLOAT":
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    if input_type == "BOOLEAN":
        return isinstance(value, bool)
    if input_type == "STRING":
        return isinstance(value, str)
    if input_type == "COMBO":
        return True
    return True


def _extract_widget_values(node: dict[str, Any]) -> dict[str, Any]:
    values = node.get("widgets_values")
    if not isinstance(values, list):
        return {}

    widget_inputs = [inp for inp in node.get("inputs", []) if inp.get("widget")]
    extracted: dict[str, Any] = {}
    cursor = 0
    for inp in widget_inputs:
        while cursor < len(values) and not _value_matches_input_type(values[cursor], inp.get("type")):
            cursor += 1
        if cursor >= len(values):
            break
        extracted[inp["name"]] = values[cursor]
        cursor += 1
    return extracted


@dataclass
class _GraphContext:
    node_map: dict[int, dict[str, Any]]
    link_by_id: dict[int, dict[str, Any]]
    widget_values: dict[int, dict[str, Any]]
    external_inputs: dict[int, Any]


class _WorkflowFlattener:
    def __init__(self, subgraphs: dict[str, dict[str, Any]]):
        self.subgraphs = subgraphs
        self.flat_nodes: dict[str, dict[str, Any]] = {}
        self._cache: dict[tuple[int, int], str] = {}
        self._next_id = 1

    def _alloc_id(self) -> str:
        flat_id = str(self._next_id)
        self._next_id += 1
        return flat_id

    def _resolve_link(self, link: dict[str, Any], graph: _GraphContext) -> Any:
        if link["origin_id"] == -10:
            return graph.external_inputs.get(link["origin_slot"])
        return self._resolve_output(link["origin_id"], link["origin_slot"], graph)

    def _resolve_output(self, node_id: int, output_slot: int, graph: _GraphContext) -> Any:
        node = graph.node_map[node_id]
        node_type = node["type"]

        if node_type == "Reroute":
            reroute_in = node.get("inputs", [{}])[0]
            if reroute_in.get("link") is None:
                return None
            return self._resolve_link(graph.link_by_id[reroute_in["link"]], graph)

        if node_type in self.subgraphs:
            subgraph = self.subgraphs[node_type]
            sub_ctx = _GraphContext(
                node_map={n["id"]: n for n in subgraph["nodes"]},
                link_by_id={l["id"]: l for l in _normalize_links(subgraph["links"])},
                widget_values={n["id"]: _extract_widget_values(n) for n in subgraph["nodes"]},
                external_inputs={},
            )
            outer_widgets = graph.widget_values.get(node_id, {})
            for index, inp in enumerate(node.get("inputs", [])):
                if inp.get("link") is not None:
                    sub_ctx.external_inputs[index] = self._resolve_link(
                        graph.link_by_id[inp["link"]],
                        graph,
                    )
                elif inp["name"] in outer_widgets:
                    sub_ctx.external_inputs[index] = outer_widgets[inp["name"]]

            target_link = None
            for link in sub_ctx.link_by_id.values():
                if link["target_id"] == -20 and link["target_slot"] == output_slot:
                    target_link = link
                    break
            if target_link is None:
                return None
            return self._resolve_link(target_link, sub_ctx)

        cache_key = (id(graph.node_map), node_id)
        if cache_key in self._cache:
            return [self._cache[cache_key], output_slot]

        flat_id = self._alloc_id()
        self._cache[cache_key] = flat_id

        inputs: dict[str, Any] = {}
        widget_values = graph.widget_values.get(node_id, {})
        for inp in node.get("inputs", []):
            name = inp["name"]
            if inp.get("link") is not None:
                source = self._resolve_link(graph.link_by_id[inp["link"]], graph)
                if source is not None:
                    inputs[name] = source
            elif name in widget_values:
                inputs[name] = widget_values[name]

        self.flat_nodes[flat_id] = {
            "class_type": node_type,
            "inputs": inputs,
            "_meta": {
                "title": node.get("title")
                or node.get("properties", {}).get("Node name for S&R", "")
            },
        }
        return [flat_id, output_slot]


def convert_ui_workflow_to_api_prompt(raw: dict[str, Any]) -> dict[str, Any]:
    subgraphs = {
        subgraph["id"]: subgraph
        for subgraph in raw.get("definitions", {}).get("subgraphs", [])
    }
    root = _GraphContext(
        node_map={node["id"]: node for node in raw["nodes"]},
        link_by_id={link["id"]: link for link in _normalize_links(raw["links"])},
        widget_values={node["id"]: _extract_widget_values(node) for node in raw["nodes"]},
        external_inputs={},
    )

    flattener = _WorkflowFlattener(subgraphs)
    for node in raw["nodes"]:
        node_type = node["type"]
        if node_type == "Reroute" or node_type in subgraphs:
            continue
        flattener._resolve_output(node["id"], 0, root)

    return flattener.flat_nodes


def load_ui_workflow_as_api_prompt(path: Path) -> dict[str, Any]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    return convert_ui_workflow_to_api_prompt(raw)
