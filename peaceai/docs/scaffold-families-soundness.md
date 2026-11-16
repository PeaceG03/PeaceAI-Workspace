# Scaffold families: closed bounds, array quantifiers, integer predicates

These three shapes read only the recorded calls. They do not copy a fix. A shape is kept only when every reduced call agrees with that one form. Two forms are `CANT_DO_YET_NO_BODY`.

## Closed integer bound

`a > n` and `a >= n+1` agree on every safe integer and disagree on the open interval between them. The scaffold already treats them as one class when every example argument is an integer and both bounds are safe integers. The emitted text is the closed form when that literal is one of the examples (`a >= 6`, not `a > 5`). The closed literal is an argument the examples accept. The open literal is an argument they reject. The behavior grade still distinguishes the two forms on the floats between them, so a fix written with the open bound stays `verified_test_only`.

`cmp-guard:closed-bound` is that replacement. Deleting it leaves the first form, which is the open bound.

## Number-array quantifier

A single argument that is an array of numbers, and a boolean result, can be `some` or `every` of one comparison. An empty array is false for `some` and true for `every`, so the examples pick one. Integer classes use the same closed representative as a scalar comparison. Two classes, including `item > 0` and `item >= 2` when `1` is not an element the examples decide, are `CANT_DO_YET_NO_BODY`.

`quant-guard:one-class` is that refusal. Deleting it emits one of the two classes.

## Integer conjunction, and one default property

`Number.isInteger(a) && <comparison>` is emitted only when a non-integer example is present, every non-integer example is false, the bare comparison does not already fit those non-integers, and the integer examples have one class. On the integers the conjunction matches the closed comparison. On a non-integer it is false, which is what those examples say. A non-integer the examples accept is not this shape. A gap such as `0` false and `2` true, with no `1`, is two classes and is refused.

`int-guard:needs-fraction` refuses the conjunction when every example is already an integer, so it does not compete with the bare comparison. `int-guard:others-false` refuses it when a non-integer example is true. `int-guard:one-class` refuses two integer classes.

A missing property of a default export is attached only when the group is that one property and the default value is one object literal, or `Object.assign` with one object-literal argument. The property is `name: name` and the function is appended. Two properties, two object bags, or a property that is already there are `CANT_DO_YET_NO_BODY`. A new module, with no file yet, still builds its own default object as before.

`TypeError: obj.method is not a function` names `method`. Naming `obj` would treat every call on that binding as missing. `prop-guard:member` is that choice. `prop-guard:one-prop`, `prop-guard:one-object`, and `prop-guard:present` are the other refusals.
