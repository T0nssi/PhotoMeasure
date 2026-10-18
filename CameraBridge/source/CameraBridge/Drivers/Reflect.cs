using System.Reflection;

namespace CameraBridge;

/// <summary>Late-bound calls into an assembly that is not referenced at build time (Basler.Pylon.dll).
/// Members are looked up on the object's type and on all its interfaces, so it also works when the
/// implementing classes are internal and only the interfaces are public.</summary>
public static class R
{
    private const BindingFlags Inst = BindingFlags.Public | BindingFlags.Instance;

    private static IEnumerable<Type> TypeAndInterfaces(Type t)
    {
        yield return t;
        foreach (var i in t.GetInterfaces()) yield return i;
    }

    public static PropertyInfo FindProp(Type t, string name) =>
        TypeAndInterfaces(t).Select(x => x.GetProperty(name, Inst | BindingFlags.DeclaredOnly) ?? (x == t ? SafeProp(x, name) : null)).FirstOrDefault(p => p != null && p.GetIndexParameters().Length == 0);

    private static PropertyInfo SafeProp(Type t, string name)
    {
        try { return t.GetProperty(name, Inst); } catch (AmbiguousMatchException) { return t.GetProperties(Inst).FirstOrDefault(p => p.Name == name && p.GetIndexParameters().Length == 0); }
    }

    public static object Get(object o, string name)
    {
        var p = FindProp(o.GetType(), name) ?? throw new MissingMemberException(o.GetType().FullName, name);
        return Unwrap(() => p.GetValue(o));
    }
    public static bool TryGet(object o, string name, out object value)
    {
        value = null;
        var p = o == null ? null : FindProp(o.GetType(), name);
        if (p == null) return false;
        try { value = p.GetValue(o); return true; } catch { return false; }
    }
    public static void Set(object o, string name, object value)
    {
        var p = FindProp(o.GetType(), name) ?? throw new MissingMemberException(o.GetType().FullName, name);
        Unwrap<object>(() => { p.SetValue(o, Arg(value, p.PropertyType)); return null; });
    }

    /// <summary>Indexer this[key] where the index parameter type accepts key's type.</summary>
    public static object Index(object o, object key) => Index(o, key, out _);

    /// <summary>Indexer this[key]; declared = the indexer's declared type (e.g. IFloatParameter), used for later calls.</summary>
    public static object Index(object o, object key, out Type declared)
    {
        foreach (var t in TypeAndInterfaces(o.GetType()))
            foreach (var p in t.GetProperties(Inst | BindingFlags.DeclaredOnly))
            {
                var ip = p.GetIndexParameters();
                if (ip.Length == 1 && ip[0].ParameterType.IsInstanceOfType(key)) { declared = p.PropertyType; return Unwrap(() => p.GetValue(o, new[] { key })); }
            }
        throw new MissingMemberException(o.GetType().FullName, $"this[{key.GetType().Name}]");
    }

    // ---- calls through a declared interface (an object may implement several parameter interfaces) ----
    private static IEnumerable<Type> Declared(Type t) => t.IsInterface ? new[] { t }.Concat(t.GetInterfaces()) : TypeAndInterfaces(t);

    public static bool HasOn(Type t, string method, int argc) => Declared(t).SelectMany(x => x.GetMethods(Inst)).Any(m => m.Name == method && m.GetParameters().Length == argc);

    public static object CallOn(Type t, object o, string method, params object[] args)
    {
        var m = Declared(t).SelectMany(x => x.GetMethods(Inst)).Where(x => x.Name == method && x.GetParameters().Length == args.Length && Fits(x, args))
            .OrderBy(x => Score(x, args)).FirstOrDefault() ?? throw new MissingMethodException(t.FullName, $"{method}({args.Length} args)");
        var ps = m.GetParameters();
        return Unwrap(() => m.Invoke(o, args.Select((x, i) => Arg(x, ps[i].ParameterType)).ToArray()));
    }

    public static object GetOn(Type t, object o, string name)
    {
        var p = Declared(t).Select(x => x.GetProperty(name, Inst | BindingFlags.DeclaredOnly)).FirstOrDefault(x => x != null && x.GetIndexParameters().Length == 0)
            ?? throw new MissingMemberException(t.FullName, name);
        return Unwrap(() => p.GetValue(o));
    }

    public static MethodInfo[] MethodsOn(Type t, string name) => Declared(t).SelectMany(x => x.GetMethods(Inst)).Where(m => m.Name == name).ToArray();

    public static bool Has(object o, string method, int argc) => FindMethod(o.GetType(), method, argc, null) != null;

    public static object Call(object o, string method, params object[] args)
    {
        var m = FindMethod(o.GetType(), method, args.Length, args) ?? throw new MissingMethodException(o.GetType().FullName, $"{method}({args.Length} args)");
        var ps = m.GetParameters();
        var a = args.Select((x, i) => Arg(x, ps[i].ParameterType)).ToArray();
        return Unwrap(() => m.Invoke(o, a));
    }

    public static object CallStatic(Type t, string method, params object[] args)
    {
        var m = t.GetMethods(BindingFlags.Public | BindingFlags.Static).FirstOrDefault(x => x.Name == method && x.GetParameters().Length == args.Length && Fits(x, args))
            ?? throw new MissingMethodException(t.FullName, method);
        if (m.IsGenericMethodDefinition) m = m.MakeGenericMethod(typeof(byte));
        var ps = m.GetParameters();
        return Unwrap(() => m.Invoke(null, args.Select((x, i) => Arg(x, ps[i].ParameterType)).ToArray()));
    }

    /// <summary>Method by name and number of arguments; prefers an exact type fit. Generic methods are closed with byte.</summary>
    public static MethodInfo FindMethod(Type t, string name, int argc, object[] args)
    {
        var all = TypeAndInterfaces(t).SelectMany(x => x.GetMethods(Inst)).Where(m => m.Name == name && m.GetParameters().Length == argc).ToList();
        if (args != null) all = all.Where(m => Fits(m, args)).ToList();
        var m0 = all.OrderBy(m => m.IsGenericMethodDefinition ? 1 : 0).ThenBy(m => Score(m, args)).FirstOrDefault();
        if (m0 != null && m0.IsGenericMethodDefinition)
        {
            try { m0 = m0.MakeGenericMethod(Enumerable.Repeat(typeof(byte), m0.GetGenericArguments().Length).ToArray()); } catch { return null; }
        }
        return m0;
    }

    private static int Score(MethodInfo m, object[] args)
    {
        if (args == null) return 0;
        int s = 0; var ps = m.GetParameters();
        for (int i = 0; i < args.Length; i++) if (args[i] == null || ps[i].ParameterType != args[i].GetType()) s++;
        return s;
    }

    private static bool Fits(MethodInfo m, object[] args)
    {
        var ps = m.GetParameters();
        for (int i = 0; i < args.Length; i++)
        {
            var pt = ps[i].ParameterType; var a = args[i];
            if (pt.IsGenericParameter || pt.ContainsGenericParameters) { if (a == null || !(a is Array)) return false; continue; }
            if (a == null) { if (pt.IsValueType && Nullable.GetUnderlyingType(pt) == null) return false; continue; }
            if (pt.IsInstanceOfType(a)) continue;
            if (pt.IsEnum && (a is string || a.GetType().IsEnum)) continue;
            if (IsNumeric(pt) && IsNumeric(a.GetType())) continue;
            if (pt == typeof(string) && a is string) continue;
            return false;
        }
        return true;
    }

    private static bool IsNumeric(Type t) => t == typeof(int) || t == typeof(long) || t == typeof(double) || t == typeof(float) || t == typeof(uint) || t == typeof(ulong) || t == typeof(short) || t == typeof(decimal);

    public static object Arg(object a, Type pt)
    {
        if (a == null || pt.IsInstanceOfType(a) || pt.IsGenericParameter || pt.ContainsGenericParameters) return a;
        if (pt.IsEnum) return a is string s ? Enum.Parse(pt, s, true) : Enum.ToObject(pt, Convert.ToInt64(a));
        if (IsNumeric(pt)) return pt == typeof(long) || pt == typeof(int) ? Convert.ChangeType(Math.Round(Convert.ToDouble(a)), pt) : Convert.ChangeType(a, pt);
        return a;
    }

    public static object EnumValue(Type enumType, string name) => Enum.Parse(enumType, name, true);

    private static T Unwrap<T>(Func<T> f)
    {
        try { return f(); }
        catch (TargetInvocationException e) when (e.InnerException != null) { System.Runtime.ExceptionServices.ExceptionDispatchInfo.Capture(e.InnerException).Throw(); throw; }
    }

    /// <summary>Static field or property of a type (e.g. PLCamera.ExposureTime).</summary>
    public static object StaticMember(Type t, string name)
    {
        var f = t.GetField(name, BindingFlags.Public | BindingFlags.Static);
        if (f != null) return f.GetValue(null);
        var p = t.GetProperty(name, BindingFlags.Public | BindingFlags.Static);
        return p?.GetValue(null);
    }
}
