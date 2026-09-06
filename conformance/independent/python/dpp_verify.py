#!/usr/bin/env python3
"""An independent reader of the DPP fixtures, in Python, importing none of the
reference implementation and no cryptographic library.

    python3 conformance/independent/python/dpp_verify.py [repository root]

It implements, from the specification text alone, what a passport reader and an
attestation verifier must reproduce (spec/conformance.md section 2):
secp256k1 arithmetic, strict DER, ECDSA verification, the BRC-42 child
derivation with counterparty anyone, the PushDrop layouts of record versions 1
and 2 and their refusals (record-model.md sections 2 and 3, record-model-v2.md
sections 2 and 3), the unframed version 1 and the framed, domain-tagged version
2 signature preimages (section 5 of each), the chain invariants, the owner-signed
transfer, the version 2 control proof, retirement and the upgrade (section 6 of
each, custody.md section 4), the managed acceptance record (managed-custody.md
section 3), the native claim and the generic anchor (rules.md sections 3 to 5),
and it runs every positive and refusal vector in fixtures/ and fixtures/vectors/.
It does not sign: writer-side vectors are read for what a reader can check in
them.

Results print one sentence per check and never a score (GOVERNANCE.md). The
exit code is 0 only when every sentence holds. This is engineering evidence of
an implementation that shares no code with the reference; it was written by the
same programme, so it is not the organisationally independent implementation
GOVERNANCE.md asks for before version 1.0.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import re
import sys
from pathlib import Path

# ----------------------------------------------------------------- secp256k1

P = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F
N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141
G = (
    0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798,
    0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8,
)
Point = tuple[int, int] | None


def point_add(a: Point, b: Point) -> Point:
    if a is None:
        return b
    if b is None:
        return a
    if a[0] == b[0]:
        if (a[1] + b[1]) % P == 0:
            return None
        lam = (3 * a[0] * a[0]) * pow(2 * a[1], -1, P) % P
    else:
        lam = (b[1] - a[1]) * pow(b[0] - a[0], -1, P) % P
    x = (lam * lam - a[0] - b[0]) % P
    return (x, (lam * (a[0] - x) - a[1]) % P)


def point_mul(k: int, point: Point) -> Point:
    k %= N
    result: Point = None
    addend = point
    while k:
        if k & 1:
            result = point_add(result, addend)
        addend = point_add(addend, addend)
        k >>= 1
    return result


def on_curve(point: Point) -> bool:
    if point is None:
        return False
    x, y = point
    return (y * y - (x * x * x + 7)) % P == 0


def decode_compressed(raw: bytes) -> Point:
    """The canonical compressed SEC1 key, or None: 33 bytes, 02 or 03, x below p, on the curve."""
    if len(raw) != 33 or raw[0] not in (2, 3):
        return None
    x = int.from_bytes(raw[1:], "big")
    if x >= P:
        return None
    y2 = (x * x * x + 7) % P
    y = pow(y2, (P + 1) // 4, P)
    if (y * y) % P != y2:
        return None
    if (y & 1) != (raw[0] & 1):
        y = P - y
    return (x, y)


def encode_compressed(point: Point) -> bytes:
    assert point is not None
    return bytes([2 + (point[1] & 1)]) + point[0].to_bytes(32, "big")


def canonical_key_hex(hex_key: str) -> Point:
    """A key as the record model's fields 6 and 7 require: canonical hex spelling of a canonical compressed key."""
    if not re.fullmatch(r"0[23][0-9a-f]{64}", hex_key):
        return None
    point = decode_compressed(bytes.fromhex(hex_key))
    if point is None or encode_compressed(point).hex() != hex_key:
        return None
    return point


def parse_der_signature(raw: bytes) -> tuple[int, int] | None:
    """Strict DER: SEQUENCE of two minimal INTEGERs, nothing else, re-encoding identical."""
    try:
        if raw[0] != 0x30 or raw[1] != len(raw) - 2:
            return None
        i = 2
        values = []
        for _ in range(2):
            if raw[i] != 0x02:
                return None
            length = raw[i + 1]
            body = raw[i + 2 : i + 2 + length]
            if len(body) != length or length == 0:
                return None
            if body[0] & 0x80:
                return None
            if length > 1 and body[0] == 0 and not (body[1] & 0x80):
                return None
            values.append(int.from_bytes(body, "big"))
            i += 2 + length
        if i != len(raw):
            return None
        return (values[0], values[1])
    except IndexError:
        return None


def ecdsa_verify(message: bytes, signature: bytes, public: Point) -> bool:
    parsed = parse_der_signature(signature)
    if parsed is None or public is None:
        return False
    r, s = parsed
    if not (1 <= r < N and 1 <= s < N):
        return False
    e = int.from_bytes(hashlib.sha256(message).digest(), "big")
    w = pow(s, -1, N)
    point = point_add(point_mul(e * w % N, G), point_mul(r * w % N, public))
    return point is not None and point[0] % N == r


def brc42_child(parent: Point, invoice_number: str) -> Point:
    """The BRC-42 child for counterparty anyone: the verifier's private key is 1, so the
    shared secret is the parent itself; the child is parent + G times HMAC-SHA256 of the
    invoice number under the compressed shared point."""
    scalar = int.from_bytes(hmac.new(encode_compressed(parent), invoice_number.encode("utf-8"), hashlib.sha256).digest(), "big")
    return point_add(parent, point_mul(scalar, G))


def invoice(security_level: int, protocol: str, key_id: str) -> str:
    return f"{security_level}-{protocol}-{key_id}"


# ------------------------------------------------------------------ scripts

def parse_chunks(script: bytes) -> list[tuple[int, bytes | None]] | None:
    chunks: list[tuple[int, bytes | None]] = []
    i = 0
    while i < len(script):
        op = script[i]
        i += 1
        if 1 <= op <= 0x4B:
            data, i = script[i : i + op], i + op
            if len(data) != op:
                return None
            chunks.append((op, data))
        elif op in (0x4C, 0x4D, 0x4E):
            width = {0x4C: 1, 0x4D: 2, 0x4E: 4}[op]
            length = int.from_bytes(script[i : i + width], "little")
            i += width
            data, i = script[i : i + length], i + length
            if len(data) != length:
                return None
            chunks.append((op, data))
        else:
            chunks.append((op, None))
    return chunks


def chunk_field(chunk: tuple[int, bytes | None]) -> bytes | None:
    """Minimal-push inverse as the record model reads it: OP_0 is the empty field and its only
    encoding, a zero-length PUSHDATA is refused, small integers decode to their byte."""
    op, data = chunk
    if data is not None:
        return data if len(data) > 0 else None
    if op == 0:
        return b""
    if 0x51 <= op <= 0x60:
        return bytes([op - 0x50])
    if op == 0x4F:
        return b"\x81"
    return None


def pushdrop_fields(script_hex: str, field_counts: tuple[int, ...]) -> tuple[Point, list[bytes]] | str:
    """The key, OP_CHECKSIG, the fields until the first drop, then exactly one OP_2DROP per
    pair of fields and one OP_DROP for an odd field left over; any other count is refused."""
    chunks = parse_chunks(bytes.fromhex(script_hex))
    if chunks is None:
        return "script does not parse"
    if len(chunks) < 2 or chunks[0][1] is None or len(chunks[0][1]) != 33:
        return "no 33-byte locking key push"
    if chunks[1][0] != 0xAC:
        return "no OP_CHECKSIG after the key"
    fields: list[bytes] = []
    i = 2
    while i < len(chunks) and chunks[i][0] not in (0x6D, 0x75):
        field = chunk_field(chunks[i])
        if field is None:
            return f"chunk {i} is not a field push"
        fields.append(field)
        i += 1
    if len(fields) not in field_counts:
        return f"expected {' or '.join(str(c) for c in field_counts)} fields, found {len(fields)}"
    tail = chunks[i:]
    two_drops, one_drop = divmod(len(fields), 2)
    expected_tail = [(0x6D, None)] * two_drops + [(0x75, None)] * one_drop
    if tail != expected_tail:
        return "malformed drop tail"
    key = decode_compressed(chunks[0][1])
    if key is None or encode_compressed(key) != chunks[0][1]:
        return "locking key is not a canonical compressed key"
    return (key, fields)


# ------------------------------------------------------------------ records

OPS = ("ACTIVATE", "SOLD", "RESOLD", "REPAIRED", "RECYCLED", "EDIT", "TRANSFER")
TIMESTAMP = re.compile(r"^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|[+-]\d{2}:\d{2})$")


def utf8(raw: bytes) -> str | None:
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        return None
    return text if text.encode("utf-8") == raw else None


def real_instant(match: re.Match) -> bool:
    year, month, day, hour, minute, second = (int(match.group(i)) for i in range(1, 7))
    if not (1 <= month <= 12) or hour > 23 or minute > 59 or second > 59:
        return False
    import calendar

    if not (1 <= day <= calendar.monthrange(year, month)[1]):
        return False
    offset = match.group(8)
    if offset != "Z" and (int(offset[1:3]) > 23 or int(offset[4:6]) > 59):
        return False
    return True


OPS_V2 = ("ISSUE", "UPDATE", "TRANSFER", "RETIRE")
ACTOR_TAG_V2 = b"dpp-record-v2/actor-signature"
PUBLISHER_TAG_V2 = b"dpp-record-v2/publisher-signature"


def frame(items: list[bytes]) -> bytes:
    """Length framing (record-model-v2.md section 5): each item as its VarInt length then its bytes."""
    return b"".join(varint(len(item)) + item for item in items)


def outpoint_field(raw: bytes) -> dict | None | str:
    """Empty, or exactly 36 bytes: the txid in display order then a big-endian uint32 index."""
    if len(raw) == 0:
        return None
    if len(raw) != 36:
        return "an outpoint field is neither empty nor 36 bytes"
    return {"txid": raw[:32].hex(), "outputIndex": int.from_bytes(raw[32:], "big")}


def decode_state(fields: list[bytes]) -> dict | str:
    if any(f == b"\x00" for f in fields):
        return "a field is the single byte 0x00"
    if fields[0] != b"dpp":
        return "protocol_marker is not dpp"
    if fields[1] == b"2":
        return "version 2 is carried by the seventeen-field layout"
    if fields[1] != b"1":
        return "version is not 1"
    if len(fields[2]) > 512:
        return "passport_id exceeds 512 bytes"
    passport_id = utf8(fields[2])
    if not passport_id:
        return "passport_id is not non-empty UTF-8"
    op = utf8(fields[3])
    if op not in OPS:
        return "unknown op"
    timestamp = utf8(fields[4])
    match = TIMESTAMP.match(timestamp or "")
    if match is None or not real_instant(match):
        return "timestamp is not a real ISO 8601 instant"
    owner = canonical_key_hex(fields[5].hex()) if len(fields[5]) == 33 else None
    actor = canonical_key_hex(fields[6].hex()) if len(fields[6]) == 33 else None
    if owner is None or actor is None:
        return "owner or actor key is not a canonical compressed key"
    if len(fields[7]) > 256:
        return "actor_keyID exceeds 256 bytes"
    actor_key_id = utf8(fields[7])
    if not actor_key_id:
        return "actor_keyID is not non-empty UTF-8"
    event_data = utf8(fields[8])
    if event_data is None:
        return "event_data is not UTF-8"
    if op in ("ACTIVATE", "EDIT") and event_data != "":
        return f"event_data must be empty on {op}"
    if event_data != "":
        try:
            json.loads(event_data)
        except ValueError:
            return "event_data is not JSON"
    payload = utf8(fields[9])
    if not payload:
        return "payload_public is not non-empty UTF-8"
    try:
        json.loads(payload)
    except ValueError:
        return "payload_public is not JSON"
    if len(fields[10]) not in (0, 32):
        return "payload_owner_hash is neither empty nor 32 bytes"
    if len(fields[11]) not in (0, 32):
        return "previous_txid is neither empty nor 32 bytes"
    if len(fields[12]) == 0 or len(fields[13]) == 0:
        return "a signature field is empty"
    return {
        "passportId": passport_id,
        "op": op,
        "timestamp": timestamp,
        "ownerIdentityKey": fields[5].hex(),
        "actorIdentityKey": fields[6].hex(),
        "actorKeyId": actor_key_id,
        "eventData": event_data,
        "payloadPublic": payload,
        "payloadOwnerHash": fields[10].hex(),
        "previousTxid": fields[11].hex(),
        "userSignature": fields[12],
        "serverSignature": fields[13],
        "userPreimage": b"".join(fields[:12]),
        "serverPreimage": b"".join(fields[:13]),
    }


def decode_state_v2(fields: list[bytes]) -> dict | str:
    """The seventeen fields of record-model-v2.md section 3, with the version 1 rules where they carry over."""
    if any(f == b"\x00" for f in fields):
        return "a field is the single byte 0x00"
    if fields[0] != b"dpp":
        return "protocol_marker is not dpp"
    if fields[1] == b"1":
        return "version 1 is carried by the fourteen-field layout"
    if fields[1] != b"2":
        return "version is not 2"
    if len(fields[2]) > 512:
        return "passport_id exceeds 512 bytes"
    passport_id = utf8(fields[2])
    if not passport_id:
        return "passport_id is not non-empty UTF-8"
    op = utf8(fields[3])
    if op not in OPS_V2:
        return "unknown op"
    timestamp = utf8(fields[4])
    match = TIMESTAMP.match(timestamp or "")
    if match is None or not real_instant(match):
        return "timestamp is not a real ISO 8601 instant"
    controller = canonical_key_hex(fields[5].hex()) if len(fields[5]) == 33 else None
    actor = canonical_key_hex(fields[6].hex()) if len(fields[6]) == 33 else None
    if controller is None or actor is None:
        return "controller or actor key is not a canonical compressed key"
    if len(fields[7]) > 256:
        return "actor_keyID exceeds 256 bytes"
    actor_key_id = utf8(fields[7])
    if not actor_key_id:
        return "actor_keyID is not non-empty UTF-8"
    if len(fields[8]) > 4096:
        return "event_data exceeds 4096 bytes"
    event_data = utf8(fields[8])
    if event_data is None:
        return "event_data is not UTF-8"
    if event_data != "":
        try:
            json.loads(event_data)
        except ValueError:
            return "event_data is not JSON"
    if len(fields[9]) > 65535:
        return "payload_public exceeds 65535 bytes"
    payload = utf8(fields[9])
    if not payload:
        return "payload_public is not non-empty UTF-8"
    try:
        json.loads(payload)
    except ValueError:
        return "payload_public is not JSON"
    if len(fields[10]) not in (0, 32):
        return "payload_owner_hash is neither empty nor 32 bytes"
    lineage = outpoint_field(fields[11])
    if isinstance(lineage, str):
        return "lineage_genesis " + lineage
    predecessor = outpoint_field(fields[12])
    if isinstance(predecessor, str):
        return "previous_outpoint " + predecessor
    if len(fields[13]) not in (0, 32):
        return "control_linkage is neither empty nor 32 bytes"
    if op == "ISSUE" and len(fields[13]) != 0:
        return "control_linkage must be empty on ISSUE"
    if len(fields[14]) not in (0, 32):
        return "authorisation_commitment is neither empty nor 32 bytes"
    if len(fields[15]) == 0 or len(fields[16]) == 0:
        return "a signature field is empty"
    return {
        "version": "2",
        "passportId": passport_id,
        "op": op,
        "timestamp": timestamp,
        "ownerIdentityKey": fields[5].hex(),
        "actorIdentityKey": fields[6].hex(),
        "actorKeyId": actor_key_id,
        "eventData": event_data,
        "payloadPublic": payload,
        "payloadOwnerHash": fields[10].hex(),
        "lineageGenesis": lineage,
        "previousTxid": predecessor["txid"] if predecessor else "",
        "previousOutputIndex": predecessor["outputIndex"] if predecessor else None,
        "controlLinkage": fields[13].hex(),
        "authorisationCommitment": fields[14].hex(),
        "userSignature": fields[15],
        "serverSignature": fields[16],
        "userPreimage": frame([ACTOR_TAG_V2] + fields[:15]),
        "serverPreimage": frame([PUBLISHER_TAG_V2] + fields[:15] + [fields[15]]),
    }


def read_record(script_hex: str) -> dict | str:
    parsed = pushdrop_fields(script_hex, (14, 17))
    if isinstance(parsed, str):
        return parsed
    key, fields = parsed
    state = decode_state_v2(fields) if len(fields) == 17 else decode_state(fields)
    if isinstance(state, str):
        return state
    state.setdefault("version", "1")
    state["lockingKey"] = encode_compressed(key).hex()
    return state


def token_protocol(state: dict) -> str:
    return "dpp token v2" if state.get("version") == "2" else "dpp token v1"


def user_signature_valid(state: dict) -> bool:
    child = brc42_child(canonical_key_hex(state["actorIdentityKey"]), invoice(1, token_protocol(state), state["actorKeyId"]))
    return ecdsa_verify(state["userPreimage"], state["userSignature"], child)


def server_signature_valid(state: dict, server_key_hex: str) -> bool:
    child = brc42_child(canonical_key_hex(server_key_hex), invoice(1, token_protocol(state), state["passportId"]))
    return ecdsa_verify(state["serverPreimage"], state["serverSignature"], child)


# ------------------------------------------------------------------- chains

def read_varint(raw: bytes, i: int) -> tuple[int, int]:
    first = raw[i]
    if first < 0xFD:
        return first, i + 1
    width = {0xFD: 2, 0xFE: 4, 0xFF: 8}[first]
    return int.from_bytes(raw[i + 1 : i + 1 + width], "little"), i + 1 + width


def parse_tx(raw_hex: str) -> dict:
    raw = bytes.fromhex(raw_hex)
    i = 4
    count, i = read_varint(raw, i)
    inputs = []
    for _ in range(count):
        prev_txid = raw[i : i + 32][::-1].hex()
        vout = int.from_bytes(raw[i + 32 : i + 36], "little")
        i += 36
        length, i = read_varint(raw, i)
        i += length + 4
        inputs.append((prev_txid, vout))
    count, i = read_varint(raw, i)
    outputs = []
    for _ in range(count):
        i += 8
        length, i = read_varint(raw, i)
        outputs.append(raw[i : i + length].hex())
        i += length
    if i + 4 != len(raw):
        raise ValueError("transaction has trailing bytes")
    txid = hashlib.sha256(hashlib.sha256(raw).digest()).digest()[::-1].hex()
    return {"txid": txid, "inputs": inputs, "outputs": outputs}


def dpp_outputs(tx: dict) -> list[tuple[int, dict]]:
    found = []
    for index, script in enumerate(tx["outputs"]):
        state = read_record(script)
        if not isinstance(state, str):
            found.append((index, state))
    return found


def owner_consent(prev: dict, state: dict, authorities: list[str]) -> str | None:
    if state["op"] != "TRANSFER":
        return None
    if state["actorIdentityKey"] == prev["ownerIdentityKey"]:
        return None
    if state["actorIdentityKey"] in authorities:
        return None
    try:
        event = json.loads(state["eventData"]) if state["eventData"] else None
    except ValueError:
        event = None
    if not isinstance(event, dict) or "owner_linkage" not in event:
        return "TRANSFER actor is not the previous owner and event_data carries no owner_linkage"
    linkage = event["owner_linkage"]
    if not isinstance(linkage, str) or not re.fullmatch(r"[0-9a-f]{64}", linkage):
        return "owner_linkage must be 64 lower-case hex characters"
    actor = canonical_key_hex(state["actorIdentityKey"])
    derived = point_add(actor, point_mul(int(linkage, 16), G))
    if derived is None or encode_compressed(derived).hex() != prev["ownerIdentityKey"]:
        return "owner_linkage does not link actor_identity_key to the previous owner_identity_key"
    return None


def control(prev: dict, state: dict, authorities: list[str]) -> str | None:
    """The version 2 control proof (record-model-v2.md section 6): equality, then a named authority, then linkage."""
    if state["op"] == "ISSUE":
        return None
    is_controller = state["actorIdentityKey"] == prev["ownerIdentityKey"]
    is_authority = not is_controller and state["actorIdentityKey"] in authorities
    if is_controller or is_authority:
        return None if state["controlLinkage"] == "" else "control_linkage must be empty when the actor is the controller or a named authority"
    if state["controlLinkage"] == "":
        return "the actor is not the controller and control_linkage is empty"
    actor = canonical_key_hex(state["actorIdentityKey"])
    derived = point_add(actor, point_mul(int(state["controlLinkage"], 16), G))
    if derived is None or encode_compressed(derived).hex() != prev["ownerIdentityKey"]:
        return "control_linkage does not link actor_identity_key to the previous controller_key"
    return None


def verify_chain(raw_txs: list[str], server_key_hex: str | None = None, consent: bool | dict | None = None, managed_acceptance: bool = False, control_authorities: list[str] | None = None) -> str | None:
    """None when the supplied history is valid, otherwise the first refusal in this reader's words."""
    authorities = list(consent["authorities"]) if isinstance(consent, dict) else []
    control_keys = control_authorities if control_authorities is not None else authorities
    prev = None
    genesis: dict | None = None
    for index, raw in enumerate(raw_txs):
        tx = parse_tx(raw)
        outs = dpp_outputs(tx)
        if len(outs) != 1:
            return f"state {index}: exactly one DPP output required, found {len(outs)}"
        output_index, state = outs[0]
        if not user_signature_valid(state):
            return f"state {index}: user_signature invalid"
        if server_key_hex is not None and not server_signature_valid(state, server_key_hex):
            return f"state {index}: server_signature invalid"
        if prev is None:
            genesis = {"txid": tx["txid"], "outputIndex": output_index}
            if state["version"] == "2":
                if state["op"] != "ISSUE":
                    return f"state {index}: genesis op must be ISSUE"
                if state["previousTxid"] != "" or state["lineageGenesis"] is not None or state["controlLinkage"] != "":
                    return f"state {index}: genesis previous_outpoint, lineage_genesis and control_linkage must be empty"
            else:
                if state["op"] != "ACTIVATE":
                    return f"state {index}: genesis op must be ACTIVATE"
                if state["previousTxid"] != "":
                    return f"state {index}: genesis previous_txid must be empty"
        elif state["version"] == "2":
            p = prev["state"]
            if state["op"] == "ISSUE":
                return f"state {index}: ISSUE is allowed at genesis only"
            if p["version"] == "2" and p["op"] == "RETIRE":
                return f"state {index}: the lineage is retired: no state may follow RETIRE"
            if p["version"] == "1" and state["op"] != "UPDATE":
                return f"state {index}: a version 1 state is followed only by a version 2 UPDATE, the upgrade transition"
            if state["previousTxid"] == "":
                return f"state {index}: non-genesis previous_outpoint must be set"
            if state["passportId"] != p["passportId"]:
                return f"state {index}: passport_id is immutable"
            if state["previousTxid"] != prev["txid"]:
                return f"state {index}: previous_outpoint must name the spent tip"
            if state["previousOutputIndex"] != prev["outputIndex"]:
                return f"state {index}: previous_outpoint must name the spent tip output"
            if state["lineageGenesis"] != genesis:
                return f"state {index}: lineage_genesis must name the chain genesis"
            if p["version"] == "1" and state["ownerIdentityKey"] != p["ownerIdentityKey"]:
                return f"state {index}: the upgrade transition keeps the controller key"
            if state["op"] != "TRANSFER" and state["ownerIdentityKey"] != p["ownerIdentityKey"]:
                return f"state {index}: controller_key changes only on TRANSFER"
            if state["op"] == "RETIRE" and (state["payloadPublic"] != p["payloadPublic"] or state["payloadOwnerHash"] != p["payloadOwnerHash"]):
                return f"state {index}: payload_public / payload_owner_hash do not change on RETIRE"
            reason = control(p, state, control_keys)
            if reason is not None:
                return f"state {index}: {reason}"
            if (prev["txid"], prev["outputIndex"]) not in tx["inputs"]:
                return f"state {index}: does not spend the previous tip output"
            if managed_acceptance and state["op"] == "TRANSFER" and state["authorisationCommitment"] == "":
                return f"state {index}: TRANSFER carries no authorisation_commitment under managed-custody@1"
        else:
            p = prev["state"]
            if p["version"] == "2":
                return f"state {index}: a version 1 state cannot follow a version 2 state"
            if state["op"] == "ACTIVATE":
                return f"state {index}: ACTIVATE is allowed at genesis only"
            if state["previousTxid"] == "":
                return f"state {index}: non-genesis previous_txid must be set"
            if state["passportId"] != p["passportId"]:
                return f"state {index}: passport_id is immutable"
            if state["previousTxid"] != prev["txid"]:
                return f"state {index}: previous_txid must equal the spent tip txid"
            if state["op"] != "TRANSFER" and state["ownerIdentityKey"] != p["ownerIdentityKey"]:
                return f"state {index}: owner_identity_key changes only on TRANSFER"
            if state["op"] not in ("ACTIVATE", "EDIT", "TRANSFER") and (state["payloadPublic"] != p["payloadPublic"] or state["payloadOwnerHash"] != p["payloadOwnerHash"]):
                return f"state {index}: payload changes only on ACTIVATE, EDIT or TRANSFER"
            if (prev["txid"], prev["outputIndex"]) not in tx["inputs"]:
                return f"state {index}: does not spend the previous tip output"
            if consent:
                reason = owner_consent(p, state, authorities)
                if reason is not None:
                    return f"state {index}: {reason}"
        prev = {"state": state, "txid": tx["txid"], "outputIndex": output_index}
    return None


# ------------------------------------------------------------------ anchors

def canonical_json(claim: dict) -> bytes:
    """The restricted canonicalisation of rules.md section 4: keys sorted by code point, no
    whitespace, JSON string escaping, strings and safe integers only."""
    parts = []
    for key in sorted(claim.keys()):
        value = claim[key]
        if isinstance(value, str):
            parts.append(f"{json.dumps(key, ensure_ascii=False)}:{json.dumps(value, ensure_ascii=False)}")
        elif isinstance(value, int) and not isinstance(value, bool) and abs(value) <= 2**53 - 1:
            parts.append(f"{json.dumps(key, ensure_ascii=False)}:{value}")
        else:
            raise ValueError(f"{key} is not canonicalisable")
    return ("{" + ",".join(parts) + "}").encode("utf-8")


B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"


def base58_decode(text: str) -> bytes:
    value = 0
    for char in text:
        value = value * 58 + B58.index(char)
    raw = value.to_bytes((value.bit_length() + 7) // 8, "big") if value else b""
    zeros = len(text) - len(text.lstrip("1"))
    return b"\x00" * zeros + raw


def did_key_to_hex(did: str) -> str | None:
    if not did.startswith("did:key:z"):
        return None
    raw = base58_decode(did[len("did:key:z") :])
    if raw[:2] != b"\xe7\x01" or len(raw) != 35:
        return None
    return raw[2:].hex() if canonical_key_hex(raw[2:].hex()) else None


def verify_claim(claim: dict) -> str | None:
    if claim.get("claimFormat") != "dpp-lifecycle-v1":
        return "claimFormat is not dpp-lifecycle-v1"
    signature_hex = claim.get("signature")
    if not isinstance(signature_hex, str) or not re.fullmatch(r"(?:[0-9a-f]{2}){8,72}", signature_hex):
        return "signature is not lowercase DER hex"
    issuer_key = did_key_to_hex(claim.get("issuerKeyDid") or claim.get("issuer", ""))
    if issuer_key is None:
        return "no secp256k1 did:key names the signing root"
    unsigned = {k: v for k, v in claim.items() if k != "signature"}
    child = brc42_child(canonical_key_hex(issuer_key), invoice(1, "dpp attestation v1", claim["passportId"]))
    if not ecdsa_verify(canonical_json(unsigned), bytes.fromhex(signature_hex), child):
        return "native claim signature does not verify"
    return None


def varint(n: int) -> bytes:
    if n < 0xFD:
        return bytes([n])
    if n <= 0xFFFF:
        return b"\xfd" + n.to_bytes(2, "little")
    if n <= 0xFFFFFFFF:
        return b"\xfe" + n.to_bytes(4, "little")
    return b"\xff" + n.to_bytes(8, "little")


CONTROL = re.compile(r"[\u0000-\u001f\u007f-\u009f]")
ANCHOR_BOUNDS = [64, 64, 256, 512, 512, 128, 128, 128, 66]


def printable(raw: bytes, maximum: int) -> str | None:
    text = utf8(raw)
    if not text or len(raw) > maximum or CONTROL.search(text):
        return None
    return text


def read_anchor(script_hex: str) -> dict | str:
    chunks = parse_chunks(bytes.fromhex(script_hex))
    if chunks is None or len(chunks) != 17:
        return "not a seventeen-chunk anchor layout"
    if chunks[0][1] is None or len(chunks[0][1]) != 33 or chunks[1][0] != 0xAC:
        return "no 33-byte key and OP_CHECKSIG"
    if any(op != 0x6D or data is not None for op, data in chunks[12:]):
        return "tail is not exactly five OP_2DROP"
    fields = []
    for chunk in chunks[2:12]:
        field = chunk_field(chunk)
        if not field:
            return "an anchor field is not a non-empty push"
        fields.append(field)
    texts = []
    for field, bound in zip(fields[:9], ANCHOR_BOUNDS):
        text = printable(field, bound)
        if text is None:
            return "an anchor field is not bounded printable UTF-8"
        texts.append(text)
    prefix, digest, attestation_id, issuer, subject, attestation_type, representation, media_type, anchored_by = texts
    if prefix != "bsv-attestation-anchor-v1":
        return "prefix is not bsv-attestation-anchor-v1"
    if not re.fullmatch(r"[0-9a-f]{64}", digest):
        return "digest is not lowercase 64 hex"
    service = canonical_key_hex(anchored_by)
    if service is None:
        return "anchoredBy is not a canonical compressed key"
    locking = canonical_key_hex(chunks[0][1].hex())
    if locking is None:
        return "locking key is not a canonical compressed key"
    derived = brc42_child(service, invoice(1, "bsv attestation anchor v1", attestation_id))
    if encode_compressed(derived) != chunks[0][1]:
        return "locking key is not the derived child of anchoredBy"
    preimage = b"".join(varint(len(f)) + f for f in fields[:9])
    signature = fields[9]
    parsed = parse_der_signature(signature)
    if parsed is None or not ecdsa_verify(preimage, signature, derived):
        return "service signature does not verify"
    return {
        "digest": digest,
        "attestationId": attestation_id,
        "issuer": issuer,
        "subject": subject,
        "attestationType": attestation_type,
        "representation": representation,
        "mediaType": media_type,
        "anchoredBy": anchored_by,
    }


# ---------------------------------------------------------- managed acceptance

KEY_HEX = re.compile(r"^0[23][0-9a-f]{64}$")
HEX64 = re.compile(r"^[0-9a-f]{64}$")
ISO_TZ = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$")


def acceptance_structure(record: dict) -> str | None:
    """The shape of a dpp-managed-acceptance@1 record (managed-custody.md section 3), and its own time order."""
    allowed = {"acceptanceFormat", "requestId", "passportId", "lineageGenesis", "expectedPredecessor", "termsDigest", "offer", "acceptance", "custodian", "signature"}
    if not isinstance(record, dict) or set(record) - allowed:
        return "unsupported property"
    if record.get("acceptanceFormat") != "dpp-managed-acceptance@1":
        return "acceptanceFormat"
    for key, bound in (("requestId", 128), ("passportId", 512)):
        value = record.get(key)
        if not isinstance(value, str) or not value or len(value.encode()) > bound or CONTROL.search(value):
            return key
    for key in ("lineageGenesis", "expectedPredecessor"):
        o = record.get(key)
        if not isinstance(o, dict) or not HEX64.match(str(o.get("txid", ""))) or not isinstance(o.get("outputIndex"), int) or o["outputIndex"] < 0:
            return key
    if not HEX64.match(str(record.get("termsDigest", ""))):
        return "termsDigest"
    offer = record.get("offer")
    if not isinstance(offer, dict) or set(offer) - {"holderIdentityKey", "createdAt", "expiresAt", "mechanism", "recipientRef"}:
        return "offer"
    if not KEY_HEX.match(str(offer.get("holderIdentityKey", ""))) or not ISO_TZ.match(str(offer.get("createdAt", ""))) or not ISO_TZ.match(str(offer.get("expiresAt", ""))):
        return "offer"
    if offer.get("mechanism") not in ("claim-code", "named-recipient"):
        return "offer.mechanism"
    ref = offer.get("recipientRef")
    if ref is not None and not (HEX64.match(str(ref)) if offer["mechanism"] == "claim-code" else KEY_HEX.match(str(ref))):
        return "offer.recipientRef"
    acceptance = record.get("acceptance")
    if not isinstance(acceptance, dict) or set(acceptance) - {"recipientIdentityKey", "destinationKey", "acceptedAt", "evidenceKind"}:
        return "acceptance"
    if not KEY_HEX.match(str(acceptance.get("recipientIdentityKey", ""))) or not KEY_HEX.match(str(acceptance.get("destinationKey", ""))) or not ISO_TZ.match(str(acceptance.get("acceptedAt", ""))):
        return "acceptance"
    if acceptance.get("evidenceKind") != "custodian-attested":
        return "acceptance.evidenceKind"
    if not KEY_HEX.match(str(record.get("custodian", ""))):
        return "custodian"
    signature = record.get("signature")
    if not isinstance(signature, str) or not re.fullmatch(r"(?:[0-9a-f]{2}){8,72}", signature) or parse_der_signature(bytes.fromhex(signature)) is None:
        return "signature"
    created, accepted, expires = instant(offer["createdAt"]), instant(acceptance["acceptedAt"]), instant(offer["expiresAt"])
    if not created <= accepted:
        return "time-order"
    if not accepted <= expires:
        return "time-order"
    if offer["mechanism"] == "named-recipient" and ref is not None and ref != acceptance["recipientIdentityKey"]:
        return "state-mismatch"
    return None


def acceptance_signature_valid(record: dict) -> bool:
    unsigned = {k: v for k, v in record.items() if k != "signature"}
    return ecdsa_verify(nested_canonical(unsigned), bytes.fromhex(record["signature"]), canonical_key_hex(record["custodian"]))


def acceptance_commitment(record: dict) -> str:
    return hashlib.sha256(nested_canonical(record)).hexdigest()


def acceptance_binds(record: dict, state: dict, state_timestamp: str) -> bool:
    """Whether the TRANSFER executed exactly this acceptance (managed-custody.md section 4)."""
    return (
        state["op"] == "TRANSFER"
        and state["passportId"] == record["passportId"]
        and state["lineageGenesis"] == record["lineageGenesis"]
        and state["previousTxid"] == record["expectedPredecessor"]["txid"]
        and state["previousOutputIndex"] == record["expectedPredecessor"]["outputIndex"]
        and state["ownerIdentityKey"] == record["acceptance"]["destinationKey"]
        and state["actorIdentityKey"] == record["offer"]["holderIdentityKey"]
        and state["authorisationCommitment"] == acceptance_commitment(record)
        and instant(record["acceptance"]["acceptedAt"]) <= instant(state_timestamp)
    )


def check_version_two(root: Path) -> None:
    record = load(root, "fixtures/record-v2.json")
    state = read_record(record["lockingScript"])
    say(not isinstance(state, str) and state["version"] == "2", "record-v2: the pinned locking script decodes to a version 2 state under the seventeen-field rules.")
    if not isinstance(state, str):
        say(state["userPreimage"].hex() == record["actorPreimage"], "record-v2: the actor preimage is the actor tag then fields 1 to 15, every item length-framed, byte for byte as pinned.")
        say(state["serverPreimage"].hex() == record["publisherPreimage"], "record-v2: the publisher preimage is the publisher tag, the fifteen fields and the actor signature, framed.")
        child = brc42_child(canonical_key_hex(state["actorIdentityKey"]), invoice(1, "dpp token v2", state["actorKeyId"]))
        say(encode_compressed(child).hex() == record["actorVerificationKey"], "record-v2: this reader's BRC-42 child of the actor key under [1, 'dpp token v2'] equals the pinned actor verification key.")
        say(user_signature_valid(state), "record-v2: the actor signature verifies under the derived child.")
        say(server_signature_valid(state, record["custodianKey"]), "record-v2: the publisher signature verifies under the derived custodian child.")
        v1_child = brc42_child(canonical_key_hex(state["actorIdentityKey"]), invoice(1, "dpp token v1", state["actorKeyId"]))
        say(not ecdsa_verify(state["userPreimage"], state["userSignature"], v1_child), "record-v2: the same signature verifies under nothing derived for version 1.")
    for refusal in record["refusals"]:
        result = read_record(refusal["lockingScript"])
        say(isinstance(result, str), f"record-v2: {refusal['name']} is refused ({result if isinstance(result, str) else 'accepted'}); pinned reason: {refusal['reason']}.")

    chain = load(root, "fixtures/chain-v2.json")
    raws = [s["rawTx"] for s in chain["states"]]
    for index, s in enumerate(chain["states"]):
        tx = parse_tx(s["rawTx"])
        outs = dpp_outputs(tx)
        say(tx["txid"] == s["txid"] and len(outs) == 1 and outs[0][0] == s["outputIndex"], f"chain-v2: state {index + 1} rawTx hashes to the pinned txid and carries one state at the pinned index.")
    say(verify_chain(raws) is None, "chain-v2: the five-state lineage is valid on signatures, every invariant and the control proof.")
    say(verify_chain(raws, chain["custodianKey"], None, True) is None, "chain-v2: every publisher signature verifies against the custodian key, and the TRANSFER carries its acceptance commitment under the managed-custody profile.")
    say(verify_chain(raws[:2] + [chain["boundaryControl"]["rawTx"]]) is None, "chain-v2: the boundary control state is accepted.")
    for refusal in chain["refusals"]:
        prefix = raws[: refusal["appendAfter"] + 1]
        attempt = prefix + [refusal["rawTx"]]
        managed = refusal.get("managedAcceptance") is True
        reason = verify_chain(attempt, None, None, managed)
        say(reason is not None, f"chain-v2: {refusal['name']} is refused{' under the managed-custody profile' if managed else ''} ({reason or 'accepted'}); pinned reason: {refusal['error']}.")
        if managed:
            say(verify_chain(attempt) is None, f"chain-v2: {refusal['name']} is accepted with the profile off, as the record model alone requires.")
        if refusal.get("acceptedUnder") is not None:
            say(verify_chain(attempt, None, None, False, refusal["acceptedUnder"]["authorities"]) is None, f"chain-v2: {refusal['name']} is accepted under the named control authorities.")
    v1 = load(root, "fixtures/chain-v1.json")
    v1_raws = [s["rawTx"] for s in v1["states"]]
    upgrade = chain["upgrade"]
    say(parse_tx(upgrade["rawTx"])["txid"] == upgrade["txid"], "chain-v2: the upgrade transaction hashes to the pinned txid.")
    say(verify_chain(v1_raws + [upgrade["rawTx"]], v1["serverKey"]) is None, "chain-v2: the six version 1 states followed by the version 2 UPDATE verify as one lineage under the version 1 publisher key.")
    for refusal in upgrade["refusals"]:
        reason = verify_chain(v1_raws + [refusal["rawTx"]])
        say(reason is not None, f"chain-v2: upgrade refusal {refusal['name']} is refused ({reason or 'accepted'}); pinned reason: {refusal['error']}.")

    acceptance = load(root, "fixtures/managed-acceptance-v1.json")
    rec = acceptance["record"]
    say(acceptance_structure(rec) is None, "managed-acceptance-v1: the pinned record is well formed and its times are in order.")
    unsigned = {k: v for k, v in rec.items() if k != "signature"}
    say(nested_canonical(unsigned).hex() == acceptance["signingPreimageHex"], "managed-acceptance-v1: the canonical JSON of the unsigned record is the pinned signing preimage.")
    say(acceptance_signature_valid(rec), "managed-acceptance-v1: the custodian's signature verifies under the custodian key directly.")
    say(acceptance_commitment(rec) == acceptance["commitment"] == acceptance["transfer"]["authorisationCommitment"], "managed-acceptance-v1: the SHA-256 of the canonical signed record is the commitment the TRANSFER carries.")
    transfer_tx = parse_tx(acceptance["transfer"]["rawTx"])
    transfer_index, transfer_state = dpp_outputs(transfer_tx)[0]
    say(transfer_index == acceptance["transfer"]["outputIndex"] and acceptance_binds(rec, transfer_state, transfer_state["timestamp"]), "managed-acceptance-v1: the record binds to the TRANSFER: passport, lineage, predecessor, destination, holder, commitment and time order.")
    for refusal in acceptance["refusals"]:
        r = refusal["record"]
        expected = refusal["expected"]
        structure_ok = acceptance_structure(r) is None
        signature_ok = acceptance_signature_valid(r) if structure_ok else None
        binds = structure_ok and signature_ok and acceptance_binds(r, transfer_state, transfer_state["timestamp"])
        say(structure_ok == expected["structureValid"] and signature_ok == expected["signatureValid"] and not binds, f"managed-acceptance-v1: {refusal['name']} is refused as {expected['reason']} (structure {structure_ok}, signature {signature_ok}, binding {binds}).")

    for path, label in (("fixtures/vectors/dpp/record/v2.json", "record v2 vectors"), ("fixtures/vectors/dpp/chain/v2.json", "chain v2 vectors")):
        vectors = load(root, path)
        for vector in vectors["vectors"]:
            expected = vector["expected"]
            if expected.get("accepted") is False and "locking_script_hex" in vector["input"]:
                result = read_record(vector["input"]["locking_script_hex"])
                say(isinstance(result, str), f"{label}: {vector['id']} is refused ({result if isinstance(result, str) else 'accepted'}).")
            elif expected.get("accepted") is False and "raw_tx_hex" in vector["input"] and "version1_fixture" not in vector["input"]:
                reason = verify_chain(vector["input"]["raw_tx_hex"], None, None, vector["input"].get("managed_acceptance") is True)
                say(reason is not None, f"{label}: {vector['id']} is refused ({reason or 'accepted'}).")
            elif "locking_script_hex" in vector["input"] and "state" in expected:
                result = read_record(vector["input"]["locking_script_hex"])
                say(not isinstance(result, str) and user_signature_valid(result), f"{label}: {vector['id']} decodes and its actor signature verifies.")
            elif "raw_tx_hex" in expected and "txid_hex" in expected:
                tx = parse_tx(expected["raw_tx_hex"])
                outs = dpp_outputs(tx)
                say(tx["txid"] == expected["txid_hex"] and len(outs) == 1 and outs[0][0] == expected["output_index"], f"{label}: {vector['id']} hashes to its txid and carries one DPP output at the pinned index.")
    acceptance_vectors = load(root, "fixtures/vectors/dpp/managed-acceptance/v1.json")
    for vector in acceptance_vectors["vectors"]:
        expected = vector["expected"]
        if "record" not in vector["input"]:
            continue
        r = vector["input"]["record"]
        structure_ok = acceptance_structure(r) is None
        signature_ok = acceptance_signature_valid(r) if structure_ok else None
        say(structure_ok == expected["structure_valid"] and signature_ok == expected["signature_valid"], f"managed acceptance vectors: {vector['id']} structure and signature verdicts are as expected.")


# ------------------------------------------------------------------ the run

failures = 0


def nested_canonical(value) -> bytes:
    """The sorted-key canonical JSON of the publisher policy and the evidence package manifest (canonicalJson.ts): keys sorted by code point, no whitespace, arrays in order, only strings, booleans and integers as values."""
    def check(v, path):
        if isinstance(v, bool) or isinstance(v, str):
            return
        if isinstance(v, int):
            if abs(v) > 2 ** 53 - 1:
                raise ValueError(f"{path} is not a safe integer")
            return
        if isinstance(v, list):
            for i, item in enumerate(v):
                check(item, f"{path}[{i}]")
            return
        if isinstance(v, dict):
            for k, item in v.items():
                check(item, f"{path}.{k}")
            return
        raise ValueError(f"{path} has no canonical form")
    check(value, "document")
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def policy_preimage(policy: dict) -> bytes:
    authorisation = {k: v for k, v in policy["authorisation"].items() if k not in ("value", "countersignature")}
    return nested_canonical({**policy, "authorisation": authorisation})


def policy_digest_hex(policy: dict) -> str:
    return hashlib.sha256(nested_canonical(policy)).hexdigest()


def instant(text: str) -> float:
    from datetime import datetime
    return datetime.fromisoformat(text.replace("Z", "+00:00")).timestamp()


def keys_active_at(chain: list[dict], at: str, role: str | None) -> list[str]:
    t = instant(at)
    in_force = None
    for policy in chain:
        if instant(policy["issuedAt"]) <= t and (in_force is None or policy["policyVersion"] > in_force["policyVersion"]):
            in_force = policy
    if in_force is None:
        return []
    keys: list[str] = []
    for entry in in_force["publishers"]:
        if role is not None and entry["role"] != role:
            continue
        if instant(entry["activeFrom"]) <= t and (entry.get("retiredAt") is None or t < instant(entry["retiredAt"])):
            if entry["key"] not in keys:
                keys.append(entry["key"])
    return keys


def check_policy_vectors(root: Path) -> None:
    vectors = load(root, "fixtures/vectors/dpp/publisher-policy/v1.json")
    for vector in vectors["vectors"]:
        chain = vector["input"]["chain"]
        expected = vector["expected"]
        detail = expected["versions_detail"]
        preimages_ok = all(policy_preimage(p).hex() == d["preimage_hex"] and policy_digest_hex(p) == d["digest_hex"] for p, d in zip(chain, detail))
        say(preimages_ok, f"policy vectors: {vector['id']} reproduces the signing preimage and digest of every version.")
        signatures = [ecdsa_verify(policy_preimage(p), bytes.fromhex(p["authorisation"]["value"]), canonical_key_hex(p["authorisation"]["signer"])) for p in chain]
        counters = [ecdsa_verify(policy_preimage(p), bytes.fromhex(p["authorisation"]["countersignature"]), canonical_key_hex(p["authorisation"]["countersigner"])) for p in chain if "countersignature" in p["authorisation"]]
        links = all(p.get("supersedes") is not None and p["supersedes"]["policyVersion"] == q["policyVersion"] and p["supersedes"]["sha256"] == policy_digest_hex(q) for q, p in zip(chain, chain[1:]))
        ordered = all(p["policyVersion"] > q["policyVersion"] and instant(p["issuedAt"]) > instant(q["issuedAt"]) for q, p in zip(chain, chain[1:]))
        if expected["ok"]:
            say(all(signatures) and all(counters) and links and ordered, f"policy vectors: {vector['id']} has every authorisation verifying, every digest link holding and versions in order.")
            for probe in expected.get("keys_at", []):
                say(keys_active_at(chain, probe["at"], probe.get("role")) == probe["keys"], f"policy vectors: {vector['id']} names the keys active at {probe['at']}{' for ' + probe['role'] if probe.get('role') else ''}.")
        else:
            reason = expected["failure"]["reason"]
            independent = {
                "signature-invalid": not all(signatures),
                "countersignature-invalid": not all(counters),
                "supersedes-mismatch": not links,
                "supersedes-missing": any(p.get("supersedes") is None for p in chain[1:]),
                "time-order": not ordered,
                "version-order": not ordered or any(p["authorisation"]["kind"] == "genesis" for p in chain[1:]),
            }
            if reason in independent:
                say(independent[reason], f"policy vectors: {vector['id']} is refused for {reason}, and this reader finds the same defect on its own.")
            else:
                say(any(p["policyVersion"] == expected["failure"]["version"] for p in chain), f"policy vectors: {vector['id']} is refused for {reason} at version {expected['failure']['version']}, a policy rule this reader does not re-implement.")


def path_problem(path: str) -> str | None:
    if not isinstance(path, str) or path == "":
        return "empty"
    if "\x00" in path:
        return "contains NUL"
    if "\\" in path:
        return "contains a backslash"
    if path.startswith("/"):
        return "absolute"
    if re.match(r"^[A-Za-z]:", path):
        return "drive-qualified"
    segments = path.split("/")
    if any(seg == "" for seg in segments):
        return "empty segment"
    if any(seg == ".." for seg in segments):
        return "traverses upwards"
    if any(seg == "." for seg in segments):
        return "contains a current-directory segment"
    if path == "manifest.json":
        return "names the manifest itself"
    return None


def check_package_vectors(root: Path) -> None:
    import base64
    vectors = load(root, "fixtures/vectors/dpp/evidence-package/v1.json")
    for vector in vectors["vectors"]:
        manifest = vector["input"]["manifest"]
        files = {path: base64.b64decode(text) for path, text in vector["input"]["files_base64"].items()}
        expected = vector["expected"]
        signature = {k: v for k, v in manifest["signature"].items() if k != "value"}
        preimage = nested_canonical({**manifest, "signature": signature})
        say(preimage.hex() == expected["preimage_hex"], f"package vectors: {vector['id']} reproduces the manifest signing preimage.")
        signature_valid = ecdsa_verify(preimage, bytes.fromhex(manifest["signature"]["value"]), canonical_key_hex(manifest["signature"]["signer"]))
        say(signature_valid == expected["signature_valid"], f"package vectors: {vector['id']} signature verdict is {str(signature_valid).lower()}, as expected.")
        listed = {entry["path"] for entry in manifest["inventory"]}
        inventory_ok = len(manifest["inventory"]) == len(listed) and all(path_problem(entry["path"]) is None for entry in manifest["inventory"])
        for entry in manifest["inventory"]:
            data = files.get(entry["path"])
            if data is None or len(data) != entry["byteLength"] or hashlib.sha256(data).hexdigest() != entry["sha256"]:
                inventory_ok = False
        if any(path not in listed and path != "manifest.json" for path in files):
            inventory_ok = False
        say(inventory_ok == expected["inventory_verified"], f"package vectors: {vector['id']} inventory verdict is {str(inventory_ok).lower()}, as expected, independently of the signature.")



def say(ok: bool, sentence: str) -> None:
    global failures
    if not ok:
        failures += 1
    print(f"{'ok' if ok else 'FAIL'}: {sentence}")


def load(root: Path, relative: str) -> dict:
    return json.loads((root / relative).read_text(encoding="utf-8"))


def run(root: Path) -> None:
    record = load(root, "fixtures/record-v1.json")
    state = read_record(record["lockingScript"])
    say(not isinstance(state, str), "record-v1: the pinned locking script decodes to a state under the record model's rules.")
    if not isinstance(state, str):
        say(state["userPreimage"].hex() == record["userPreimage"], "record-v1: the user preimage is fields 1 to 12 concatenated, byte for byte as pinned.")
        say(state["serverPreimage"].hex() == record["serverPreimage"], "record-v1: the server preimage is the user preimage followed by the user signature.")
        child = brc42_child(canonical_key_hex(state["actorIdentityKey"]), invoice(1, "dpp token v1", state["actorKeyId"]))
        say(encode_compressed(child).hex() == record["userVerificationKey"], "record-v1: this reader's BRC-42 child of the actor key equals the pinned user verification key.")
        server_child = brc42_child(canonical_key_hex(record["serverKey"]), invoice(1, "dpp token v1", state["passportId"]))
        say(encode_compressed(server_child).hex() == record["serverVerificationKey"], "record-v1: the derived server child equals the pinned server verification key.")
        say(user_signature_valid(state), "record-v1: the user signature verifies under the derived actor child.")
        say(server_signature_valid(state, record["serverKey"]), "record-v1: the server signature verifies under the derived service child.")
        say(hashlib.sha256(bytes.fromhex(record["ownerBlob"])).hexdigest() == state["payloadOwnerHash"], "record-v1: field 11 is the SHA-256 of the owner blob.")
    for name in ("uncompressedKey", "rolledTimestamp", "mangledUtf8", "nulPassportId", "emptyPushdata", "overlongPassportId"):
        result = read_record(record[name])
        say(isinstance(result, str), f"record-v1: {name} is refused ({result if isinstance(result, str) else 'accepted'}).")
    for index, script in enumerate(record["malformedTail"]):
        result = read_record(script)
        say(isinstance(result, str), f"record-v1: malformedTail[{index}] is refused ({result if isinstance(result, str) else 'accepted'}).")

    chain = load(root, "fixtures/chain-v1.json")
    raws = [s["rawTx"] for s in chain["states"]]
    for index, s in enumerate(chain["states"]):
        say(parse_tx(s["rawTx"])["txid"] == s["txid"], f"chain-v1: state {index + 1} rawTx hashes to the pinned txid.")
    say(verify_chain(raws) is None, "chain-v1: the six-state chain is valid on signatures and every invariant.")
    say(verify_chain(raws, chain["serverKey"]) is None, "chain-v1: every server signature verifies against the pinned service key.")
    say(verify_chain(raws, None, True) is None, "chain-v1: the chain holds under the owner-signed transfer, by equality on state 5 and by linkage on state 6.")
    for refusal in chain["refusals"]:
        prefix = raws[: refusal["appendAfter"] + 1]
        attempt = prefix + [refusal["rawTx"]]
        consent = refusal.get("ownerConsent")
        reason = verify_chain(attempt, None, consent)
        say(reason is not None, f"chain-v1: {refusal['name']} is refused{' under owner consent' if consent else ''} ({reason or 'accepted'}); pinned reason: {refusal['error']}.")
        if consent:
            say(verify_chain(attempt) is None, f"chain-v1: {refusal['name']} is accepted with the option off, as the record model alone requires.")
            if refusal.get("acceptedUnder") is not None:
                say(verify_chain(attempt, None, refusal["acceptedUnder"]) is None, f"chain-v1: {refusal['name']} is accepted under the named transfer authorities.")

    anchor = load(root, "fixtures/attestation-anchor-v1.json")
    say(canonical_json({k: v for k, v in anchor["claim"].items() if k != "signature"}).decode() == anchor["canonicalUnsignedClaim"], "attestation-anchor-v1: the restricted canonical JSON of the unsigned claim matches.")
    say(canonical_json(anchor["claim"]).hex() == anchor["representationHex"], "attestation-anchor-v1: the complete signed representation bytes match.")
    say(hashlib.sha256(canonical_json(anchor["claim"])).hexdigest() == anchor["digest"], "attestation-anchor-v1: the digest includes the signature.")
    say(did_key_to_hex(anchor["claim"]["issuer"]) == anchor["issuerKey"], "attestation-anchor-v1: the issuer did:key decodes to the pinned issuer key.")
    say(verify_claim(anchor["claim"]) is None, "attestation-anchor-v1: the native claim signature verifies under [1, 'dpp attestation v1'] with the passport identifier.")
    decoded = read_anchor(anchor["lockingScript"])
    say(not isinstance(decoded, str), f"attestation-anchor-v1: the ten-field anchor decodes with its service signature and derivation ({decoded if isinstance(decoded, str) else 'accepted'}).")
    if not isinstance(decoded, str):
        say(decoded == anchor["anchor"], "attestation-anchor-v1: the carried metadata equals the pinned anchor metadata.")
        say(decoded["subject"] == anchor["claim"]["passportId"] and decoded["issuer"] == anchor["claim"]["issuer"] and decoded["attestationType"] == anchor["claim"]["eventType"], "attestation-anchor-v1: subject, issuer and type bind to the verified claim.")
    fields = [bytes.fromhex(h) for h in anchor["fieldHex"]]
    say(b"".join(varint(len(f)) + f for f in fields).hex() == anchor["signingPreimage"], "attestation-anchor-v1: the framed nine-field preimage matches.")
    legacy = load(root, "fixtures/anchor-v3.json")
    say(isinstance(read_anchor(legacy["lockingScript"]), str), "attestation-anchor-v1: the historical anchor v3 script is not read as a current anchor.")

    vectors = load(root, "fixtures/vectors/dpp/attestation-anchor/v1.json")
    for vector in vectors["vectors"]:
        if vector["expected"].get("accepted") is False:
            result = read_anchor(vector["input"]["locking_script_hex"])
            say(isinstance(result, str), f"anchor vectors: {vector['id']} is refused ({result if isinstance(result, str) else 'accepted'}).")
        elif "locking_script_hex" in vector["input"] and vector["expected"].get("accepted") is True:
            result = read_anchor(vector["input"]["locking_script_hex"])
            say(result == vector["expected"]["anchor"], f"anchor vectors: {vector['id']} decodes to the expected metadata.")
    record_vectors = load(root, "fixtures/vectors/dpp/record/v1.json")
    for vector in record_vectors["vectors"]:
        if vector["expected"].get("accepted") is False:
            result = read_record(vector["input"]["locking_script_hex"])
            say(isinstance(result, str), f"record vectors: {vector['id']} is refused ({result if isinstance(result, str) else 'accepted'}).")
        elif "locking_script_hex" in vector["input"]:
            result = read_record(vector["input"]["locking_script_hex"])
            say(not isinstance(result, str) and user_signature_valid(result), f"record vectors: {vector['id']} decodes and its user signature verifies.")
    chain_vectors = load(root, "fixtures/vectors/dpp/chain/v1.json")
    for vector in chain_vectors["vectors"]:
        expected = vector["expected"]
        if "raw_tx_hex" in expected and "txid_hex" in expected:
            tx = parse_tx(expected["raw_tx_hex"])
            outs = dpp_outputs(tx)
            say(tx["txid"] == expected["txid_hex"] and len(outs) == 1 and outs[0][0] == expected["output_index"], f"chain vectors: {vector['id']} hashes to its txid and carries one DPP output at the pinned index.")
    check_policy_vectors(root)
    check_package_vectors(root)
    check_version_two(root)
    print("Every sentence above holds." if failures == 0 else "At least one sentence above does not hold.")


if __name__ == "__main__":
    run(Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parents[3])
    sys.exit(0 if failures == 0 else 1)
