"""LM retrain set C v2 bits/byte gate (both modes): the candidate must beat the live model by a margin.
  bpb_gate.py <live bpb> <candidate bpb> <minBpbGain>
PASS (exit 0) iff candidate <= live - minBpbGain, in exact decimal arithmetic (fixed-point integers) (eval_c.py prints 4 decimals, so a float
subtraction such as 1.6506 - 0.005 = 1.6455999999999997 would wrongly fail a candidate at exactly 1.6456). minBpbGain is
lm-retrain.json eval.minBpbGain and must be a finite number > 0: a zero or negative margin, a non-number, NaN or inf is
refused (exit 2), which the workflow's gate counts as a set C failure (fail closed). Any other outcome exits 1.
The candidate is the model retrained to the validation-selected step; set C is the final gate only (nothing upstream
of this reads it). Prints one line of numbers only."""
import re
import sys

NUM = re.compile(r"^(-?)([0-9]+)(?:\.([0-9]{1,12}))?$")
SCALE = 12  # digits after the point; inputs with more are refused


def parse(s):
    """A plain decimal string -> integer units of 1e-12 (exact). Anything else (exponents, nan, inf, empty) refused."""
    m = NUM.match(s.strip()) if isinstance(s, str) else None
    if not m:
        raise ValueError("not a plain decimal number")
    v = int(m.group(2)) * 10**SCALE + int((m.group(3) or "").ljust(SCALE, "0"))
    return -v if m.group(1) else v


def fmt(v):
    sgn, v = ("-" if v < 0 else ""), abs(v)
    return f"{sgn}{v // 10**SCALE}.{str(v % 10**SCALE).rjust(SCALE, '0').rstrip('0') or '0'}"


def gate(live, cand, gain):
    """(pass, threshold string). Raises ValueError on a bad input or a margin <= 0."""
    lv, cd, g = parse(live), parse(cand), parse(gain)
    if g <= 0:
        raise ValueError("minBpbGain must be > 0")
    if lv <= 0 or cd <= 0:
        raise ValueError("bits/byte must be > 0")
    need = lv - g
    return cd <= need, fmt(need)


def main():
    if len(sys.argv) != 4:
        print("bpb gate: usage: bpb_gate.py <live> <candidate> <minBpbGain>: refused")
        sys.exit(2)
    try:
        ok, need = gate(*sys.argv[1:4])
    except ValueError as e:
        print(f"bpb gate: {e}: refused")
        sys.exit(2)
    print(f"setc_bpb gate live={sys.argv[1]} candidate={sys.argv[2]} min_gain={sys.argv[3]} need_at_most={need} pass={str(ok).lower()}")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
