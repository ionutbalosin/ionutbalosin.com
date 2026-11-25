# Primitive Types in Patterns, instanceof, and switch: Exact Conversions Made Explicit

## Content

- [Introduction](#introduction)
- [The Primitive Gap in Pattern Matching](#the-primitive-gap-in-pattern-matching)
- [Exactness as the Unifying Rule](#exactness-as-the-unifying-rule)
- [Technical Deep Dive](#technical-deep-dive)
- [Performance Analysis](#performance-analysis)
- [Practical Examples](#practical-examples)
- [Migration Considerations](#migration-considerations)
- [Conclusions](#conclusions)
- [References](#references)

## Introduction

Pattern matching in Java has so far been mostly about reference types. JDK 26 (fourth preview, JEP 530) and JDK 27 (fifth preview, JEP 532) continue the work of allowing primitive types in all pattern contexts and of extending `instanceof` and `switch` to every primitive type. Below I look at what changes for `int`, `long`, `double` and friends, how javac and the runtime implement it, and which previously legal `switch` constructs are now rejected.

The feature was first proposed for JDK 23 and re-previewed in JDK 24 and JDK 25 without change. JEP 530 is the first iteration that modifies the rules: it enhances the definition of *unconditional exactness* and tightens the *dominance* checks in `switch`. JEP 532 previews the feature a fifth time without change, so everything below applies equally to JDK 26 and JDK 27.

The central idea is one question asked uniformly for reference and primitive types: can this value be converted to that type without losing information? If so, a pattern such as `int i` matches; otherwise it does not.

## The Primitive Gap in Pattern Matching

Before this feature, pattern matching treated primitive types inconsistently:

- **Type patterns in `switch`** (JEP 441) and in **`instanceof`** (JEP 394) accepted only reference types; `case int i` or `x instanceof int` were not allowed.
- **Record patterns** (JEP 440) allowed primitive component patterns only when the pattern type was identical to the component type. For `record JsonNumber(double d)`, the pattern `JsonNumber(int a)` was rejected; the developer had to bind a `double` and cast manually.
- **`switch` selectors** accepted `byte`, `short`, `char`, `int`, their wrappers, `String` and enums, but not `long`, `float`, `double` or `boolean`.

Converting an `int` to a `byte` requires a lossy explicit cast, so it must be guarded by hand:

```java
if (i >= -128 && i <= 127) {
    byte b = (byte) i;
    // ... b ...
}
```

At the same time, `int` to `float` happens silently in an assignment context even though it loses precision above 2^24. For reference types an unsafe cast throws a `ClassCastException`; for primitive types it silently loses magnitude, sign or precision.

## Exactness as the Unifying Rule

### Exact and unconditionally exact conversions

A conversion is **exact** if no loss of information occurs for the given input value; otherwise it is **inexact**. Exactness may depend on the value: `long` to `int` is exact for `42L` but inexact for `10_000_000_000L`, and `int` to `float` is exact for `16_777_216` but inexact for `16_777_217`.

Conversions known at compile time to be exact for every value are **unconditionally exact** and need no run-time test. JEP 530 distinguishes two categories:

- **Type-based**: widening from one integral type to another (except `byte` to `char`), `float` to `double`, `byte`/`short`/`char` to a floating-point type, `int` to `double`, boxing, and widening reference conversions. `int` to `float` and `long` to `float`/`double` are excluded because they can lose precision.
- **Value-based**: the input is a constant expression and a compile-time test shows that converting this particular constant loses nothing, for example the `int` constant `42` to `byte`, or `4096` to `float`.

The value-based category is one of the two changes introduced by JEP 530 and feeds into the dominance rules below. In the JEP's table, `ɛ` is unconditionally exact, `ω` a widening conversion that still needs a run-time check, `η` a narrowing conversion, `ωη` widening-and-narrowing and `≈` the identity:

| From ↓ / To → | byte | short | char | int | long | float | double |
|---|---|---|---|---|---|---|---|
| byte   | ≈ | ɛ | ωη | ɛ | ɛ | ɛ | ɛ |
| short  | η | ≈ | η  | ɛ | ɛ | ɛ | ɛ |
| char   | η | η | ≈  | ɛ | ɛ | ɛ | ɛ |
| int    | η | η | η  | ≈ | ɛ | ω | ɛ |
| long   | η | η | η  | η | ≈ | ω | ω |
| float  | η | η | η  | η | η | ≈ | ɛ |
| double | η | η | η  | η | η | η | ≈ |

`boolean` converts only to itself, so `b instanceof char` is a compile-time error when `b` is a `boolean`.

### instanceof as the precondition for a safe cast

`x instanceof T` returns `true` if the value of `x` can be converted to `T` by an exact conversion; `x instanceof T t` also performs the conversion and binds the result:

```java
byte b = 42;
b instanceof int;        // true (unconditionally exact)

int j = 16_777_217;      // 2^24 + 1
j instanceof byte;       // false (not exact)
j instanceof float;      // false (not exact)
j instanceof double;     // true (unconditionally exact)

Integer ii = 16_777_217;
ii instanceof float;     // false (unboxing, then an inexact int -> float)
```

No new conversions are added: `instanceof` is applicable where a casting conversion exists (JLS §5.5), and the run-time result is determined by exactness.

### Applicability, unconditionality, matching and exhaustiveness

`T t` is **applicable** to a candidate of type `U` if `U` can be cast to `T` without an unchecked warning (previously, a primitive pattern required identical types). `T t` is **unconditional** on `U` if the conversion is unconditionally exact; such a pattern needs no run-time check and makes a `switch` exhaustive. A non-null value **matches** `T t` if it can be cast exactly to `T`.

For a wrapper selector, `T t` is exhaustive when `T` is unconditionally exact on the unboxed type, with `null` left in the remainder (`isBpCovered` in `src/jdk.compiler/share/classes/com/sun/tools/javac/comp/ExhaustivenessComputer.java`). A `switch` with both `case true` and `case false` is exhaustive, and adding a `default` to it is an error.

### Dominance and the JDK 26 tightening

`T t` dominates `U u` if `T t` would unconditionally match any candidate of type `U`, so `case long q` dominates `case int i`. JEP 530 tightens the checks in two ways.

First, constant labels are validated against preceding type patterns using **value-based** unconditional exactness:

```java
byte x = ...;
switch (x) {
    case short s -> {}
    case 42      -> {}     // JDK 26 error: 42 converts unconditionally exactly to short
}
```

Second, an **unconditional pattern dominates every label that follows it**, whether or not the following pattern is related by type:

```java
int x = ...;
switch (x) {
    case int _   -> {}  // unconditional pattern
    case float _ -> {}  // JDK 26 error: dominated
}
```

The same rule applies to reference types, which is the source-incompatible part of the JEP (see Example 4, where `case A _` followed by `case B _` on a selector of type `A` is rejected although `A` and `B` are unrelated).

## Technical Deep Dive

### Run-time exactness checks: ExactConversionsSupport

All run-time exactness checks live in `src/java.base/share/classes/java/lang/runtime/ExactConversionsSupport.java`, a final class with one static method per conversion pair that needs a check, named `is<Source>To<Target>Exact`:

```java
public static boolean isLongToIntExact(long n)     {return n == (long)(int)n;}

public static boolean isIntToFloatExact(int n) {
    return n == (int)(float)n && n != Integer.MAX_VALUE;
}

public static boolean isFloatToIntExact(float n) {
    return n == (float)(int)n && n != 0x1p31f && !isNegativeZero(n);
}

public static boolean isDoubleToFloatExact(double n) {
    return n == (double)(float)n || n != n;
}

private static boolean isNegativeZero(float n) {
    return Float.floatToRawIntBits(n) == Integer.MIN_VALUE;
}
```

Source: [ExactConversionsSupport.java](https://github.com/openjdk/jdk/blob/master/src/java.base/share/classes/java/lang/runtime/ExactConversionsSupport.java)

The technique is a round trip: convert to the target type, convert back, and compare. For integral narrowing this is sufficient, because sign extension reproduces the value only if no high-order bits were discarded. Floating-point conversions need three extra guards:

- **Saturation**: `(float) Integer.MAX_VALUE` rounds up to 2^31, and casting that back to `int` saturates to `Integer.MAX_VALUE`, so the round trip would wrongly succeed; hence the explicit exclusions of `Integer.MAX_VALUE`, `Long.MAX_VALUE` and `0x1p31f`.
- **Negative zero**: `-0.0 == 0.0` is `true`, so `isNegativeZero` inspects the raw bits; converting `-0.0` to an integer type is inexact.
- **NaN**: `NaN == NaN` is `false`, so `|| n != n` makes `double` to `float` exact for `NaN`, whereas `NaN` to an integer type remains inexact.

For example, `Double.NaN instanceof float` is `true`, `Double.NaN instanceof int` and `-0.0 instanceof int` are `false`, and `(1L << 53) instanceof double` is `true` while `((1L << 53) + 1) instanceof double` is `false`.

### Compile-time exactness and dominance in javac

The compile-time counterpart is in `src/jdk.compiler/share/classes/com/sun/tools/javac/code/Types.java`: `isUnconditionallyExactTypeBased` encodes the table above, `isUnconditionallyExactValueBased` evaluates constant expressions with the very same `ExactConversionsSupport` methods, and `isUnconditionallyExactCombined` is their disjunction. The feature is `Feature.PRIMITIVE_PATTERNS` in `Source.java`, listed as a preview in `Preview.java`, and `Attr.visitTypeTest`/`Attr.handleSwitch` call `preview.checkSourceLevel` whenever a primitive appears in a pattern context.

The JDK 26 tightening is implemented in `Check.checkSwitchCaseLabelDominated` (`src/jdk.compiler/share/classes/com/sun/tools/javac/comp/Check.java`). A first block reports `Errors.PatternDominated` for any label following the unconditional one, guarded by `allowPrimitivePatterns`, which is `true` only with preview features enabled. A second block calls `isUnconditionallyExactCombined` for constant labels, which is where `16_777_216` is checked against a preceding `case float f`.

### Lowering instanceof and switch

Primitive `instanceof` is desugared in `Lower.visitTypeTest` (`src/jdk.compiler/share/classes/com/sun/tools/javac/comp/Lower.java`) in three ways: an unconditionally exact test becomes the constant `true` (the operand is still evaluated for side effects), a test on a primitive operand becomes a direct call to the matching `ExactConversionsSupport` method, and a test on a wrapper operand becomes a null check, an unboxing call and the exactness method. The `TypePairs` record maps type pairs to method names; `byte`, `short` and `char` sources are redirected to the `int` variants. For example, the following two methods:

```java
static boolean fitsByte(int i)    { return i instanceof byte; }
static boolean alwaysTrue(byte b) { return b instanceof int; }
```

compile to:

```text
static boolean fitsByte(int);
     0: iload_0
     1: istore_1
     2: iload_1
     3: invokestatic  #7   // Method java/lang/runtime/ExactConversionsSupport.isIntToByteExact:(I)Z
     6: ireturn

static boolean alwaysTrue(byte);
     0: iload_0
     1: istore_1
     2: iconst_1
     3: ireturn
```

A `switch` with primitive patterns is handled by `src/jdk.compiler/share/classes/com/sun/tools/javac/comp/TransPatterns.java` with the same `invokedynamic` strategy as other pattern switches: an `invokedynamic` call to `SwitchBootstraps.typeSwitch` returns the index of the first matching label, and if a guard fails the index is advanced and the `switch` is restarted. For primitive patterns, `toLoadableConstant` emits a `CONSTANT_Dynamic` entry produced by `ConstantBootstraps.primitiveClass`, so the label for `case int i` is literally `int.class`; `javap -v` on Example 2 shows `typeSwitch:(II)I` with static arguments `0`, `1`, `#5:I:Ljava/lang/Class;`, `#5:I:Ljava/lang/Class;`.

On the runtime side, `src/java.base/share/classes/java/lang/runtime/SwitchBootstraps.java` spins a hidden class with a `typeSwitch(Object, int)` method. For a primitive class label, `generateTypeSwitchSkeleton` consults `unconditionalExactnessCheck` (kept "in sync with `Types.isUnconditionallyExactTypeBased`", per the source comment) and otherwise unboxes the selector and calls the corresponding `ExactConversionsSupport` method. `verifyLabel` rejects `Long`, `Float`, `Double` and `Boolean` labels unless `PreviewFeatures.isEnabled()`, hence `java --enable-preview` is required at run time as well.

## Performance Analysis

JEP 530 and JEP 532 publish no performance measurements, so this discussion is qualitative and based on the generated code.

- **Unconditionally exact tests are free**: `b instanceof int` for a `byte` compiles to `iconst_1`, and a `case int i` on an `int` selector becomes the default arm.
- **Conditional tests cost one static call**: `isIntToByteExact` and its siblings are tiny pure methods that the JIT compilers routinely inline; the cost should be comparable to the hand-written range check, with wrapper variants adding a null check and an unboxing call.
- **Pattern switches on primitives pay the `invokedynamic` linkage cost** once per call site, as existing pattern switches do; a constant-only `switch` is still a `tableswitch`/`lookupswitch`. The generated `typeSwitch` receives the selector as `Object`, so a primitive selector is boxed on entry; whether the JIT eliminates that boxing should be measured for hot code.

Use primitive patterns where you would otherwise write a range check or a lossy cast, and measure before rewriting a hot constant-only `switch`.

## Practical Examples

All examples compile with `javac --enable-preview --release 26` (or `--release 27`) and run with `java --enable-preview`.

### Example 1: Replacing a manual range check

```java
static byte toByteOrDefault(int value, byte fallback) {
    if (value instanceof byte b) {
        return b;
    }
    return fallback;
}

toByteOrDefault(100, (byte) -1);   // 100
toByteOrDefault(1000, (byte) -1);  // -1, because 1000 does not fit in a byte
```

The pattern replaces the manual `value >= -128 && value <= 127` check followed by a cast; the compiler emits `ExactConversionsSupport.isIntToByteExact`.

### Example 2: switch over int with constants, a guard and a type pattern

```java
static String classify(int status) {
    return switch (status) {
        case 0 -> "okay";
        case 1 -> "warning";
        case int i when i >= 100 -> "fatal: " + i;
        case int i -> "unknown status: " + i;
    };
}
```

The last label is unconditional on `int`, so the `switch` is exhaustive without a `default`. Under JDK 26 no further label may follow it.

### Example 3: Record pattern with primitive components

```java
record Point(double x, double y) {}

static String describe(Object o) {
    return switch (o) {
        case Point(int x, int y)       -> "grid point (" + x + ", " + y + ")";
        case Point(double x, double y) -> "free point (" + x + ", " + y + ")";
        default                        -> "not a point";
    };
}

describe(new Point(3, 4));     // grid point (3, 4)
describe(new Point(0.5, 4));   // free point (0.5, 4.0)
describe(new Point(-0.0, 1));  // free point (-0.0, 1.0), -0.0 is not exact as int
```

`Point(int x, int y)` matches only when both `double` components convert exactly to `int`; javac emits a nested `typeSwitch:(DI)I` on the first component and an explicit `isDoubleToIntExact` call for the second. The second case is not dominated, since `int` is not unconditionally exact on `double`.

### Example 4: Code accepted by JDK 25 and rejected by JDK 26

```java
interface A {}
interface B {}

static int ifaces(A a) {
    return switch (a) {
        case A _ -> 1;   // unconditional on the selector type A
        case B _ -> 2;   // JDK 26: error, this case label is dominated by a preceding case label
    };
}

static int constants(int j) {
    return switch (j) {
        case float f    -> 1;
        case 16_777_216 -> 2;   // JDK 26: error, 16_777_216 is unconditionally exact as float
        default         -> 3;
    };
}
```

Both methods compile without diagnostics under JDK 25 with preview enabled; under JDK 26 the second label of each `switch` is reported with `compiler.err.pattern.dominated`. The fix is to delete the unreachable label or, in `constants`, to move the constant before the type pattern.

## Migration Considerations

- **JDK versions and flags**: compile with `javac --release 26 --enable-preview` (respectively `--release 27` for JEP 532) and run with `java --enable-preview`; the runtime flag is required because `SwitchBootstraps.verifyLabel` rejects `Long`, `Float`, `Double` and `Boolean` labels otherwise. Preview class files run only on the feature release that produced them.
- **What changed between iterations**: JEP 455, 488 and 507 are identical in semantics; JEP 530 adds the two dominance changes described above and JEP 532 changes nothing. Code written for JDK 25 may need to drop dominated labels; code compiled without `--enable-preview` keeps the old behavior.
- **Constants must match the new selector types**: with a `float`, `double`, `long` or `boolean` selector, case constants must be literals of that type (`0f`, not `0`), otherwise `compiler.err.constant.label.not.compatible` is reported. Two floating-point literals that round to the same representation (`1.0f` and `0.999999999f`) form a duplicate label.
- **Floating-point corner cases**: `-0.0` does not match an integral pattern, `NaN` matches `float` from `double` but never an integral type, and `Integer.MAX_VALUE` does not match `float`.
- **Bytecode shape**: a single primitive type pattern turns an `int` `switch` from a `tableswitch` into an `invokedynamic`-based pattern switch.

## Conclusions

- The feature replaces hand-written range checks with a single predicate: a primitive type pattern matches when the conversion is exact. The predicate is implemented once, in `ExactConversionsSupport`, and shared by javac's constant folding, the lowered `instanceof` code and the `SwitchBootstraps` runtime.
- The JDK 26 tightening is small in surface but meaningful: constant labels are validated against preceding patterns by value, and an unconditional pattern ends the `switch`. Teams that experimented on JDK 25 should expect a few `pattern.dominated` errors and treat them as dead code being pointed out.
- Nevertheless, the floating-point corner cases deserve a unit test or two when such patterns guard business logic.

I think the feature is mature enough to try on real code in JDK 26 or 27 behind the preview flag, in particular for record decomposition where components are stored as `double` or `long` but consumed as `int`, while waiting for a finalized JEP before committing production builds to it.

## References

- [JEP 530: Primitive Types in Patterns, instanceof, and switch (Fourth Preview)](https://openjdk.org/jeps/530)
- [JEP 532: Primitive Types in Patterns, instanceof, and switch (Fifth Preview)](https://openjdk.org/jeps/532)
- [OpenJDK Source: ExactConversionsSupport.java](https://github.com/openjdk/jdk/blob/master/src/java.base/share/classes/java/lang/runtime/ExactConversionsSupport.java)

---

**Tags**: Java, JDK 26, JDK 27, Pattern Matching, Primitive Types, instanceof, switch, Record Patterns, Exact Conversions, javac, Preview Features, Project Amber
