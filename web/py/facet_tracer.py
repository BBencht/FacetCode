"""FACET — lépésenkénti futtatás: a program minden lépésénél elmenti a sort és a változókat."""
import sys, os, json, io, builtins, runpy, traceback, types

target = os.path.abspath(sys.argv[1])
root = os.path.abspath(sys.argv[2])
MAX = int(sys.argv[3]) if len(sys.argv) > 3 else 800
inputs = sys.stdin.read().split('\n')
if inputs and inputs[-1] == '':
    inputs.pop()
it = iter(inputs)
out = io.StringIO()
steps = []


class Stop(Exception):
    pass


def fake_input(prompt=''):
    out.write(str(prompt))
    try:
        v = next(it)
    except StopIteration:
        raise EOFError('EOF when reading a line')
    out.write(v + '\n')
    return v


def rep(v):
    try:
        if isinstance(v, (types.FunctionType, types.BuiltinFunctionType, types.MethodType)):
            return ('fn', getattr(v, '__name__', '?') + '()')
        if isinstance(v, type):
            return ('cls', 'osztály ' + v.__name__)
        if isinstance(v, types.ModuleType):
            return None
        r = repr(v)
        if len(r) > 160:
            r = r[:157] + '…'
        return (type(v).__name__, r)
    except Exception:
        return (type(v).__name__, '<' + type(v).__name__ + ' objektum>')


_mine = {}


def mine(fn):
    r = _mine.get(fn)
    if r is None:
        a = os.path.abspath(fn)
        r = (not fn.startswith('<')) and os.path.isfile(a) and a.startswith(root + os.sep) and os.sep + 'site-packages' + os.sep not in a and os.sep + '.venv' + os.sep not in a and os.sep + 'venv' + os.sep not in a
        _mine[fn] = r
    return r


def frames(frame):
    res = []
    f = frame
    while f is not None:
        if mine(f.f_code.co_filename):
            vs = {}
            for k, v in list(f.f_locals.items())[:40]:
                if k.startswith('__') and k.endswith('__'):
                    continue
                r = rep(v)
                if r is not None:
                    vs[k] = r
            name = f.f_code.co_name
            res.append({'fn': '(modul)' if name == '<module>' else name, 'file': os.path.relpath(f.f_code.co_filename, root).replace(os.sep, '/'), 'line': f.f_lineno, 'vars': vs})
        f = f.f_back
    res.reverse()
    return res


def tracer(frame, event, arg):
    if not mine(frame.f_code.co_filename):
        return None
    if event in ('line', 'return', 'exception'):
        st = {'e': event, 'line': frame.f_lineno, 'file': os.path.relpath(frame.f_code.co_filename, root).replace(os.sep, '/'), 'o': len(out.getvalue()), 'stack': frames(frame)}
        if event == 'return':
            r = rep(arg)
            st['ret'] = r[1] if r else None
        if event == 'exception':
            st['exc'] = arg[0].__name__ + ': ' + str(arg[1])
        steps.append(st)
        if len(steps) >= MAX:
            raise Stop()
    return tracer


real = sys.stdout
builtins.input = fake_input
sys.stdout = out
sys.argv = [target]
sys.path.insert(0, os.path.dirname(target))
os.chdir(os.path.dirname(target))
error = None
truncated = False
sys.settrace(tracer)
try:
    runpy.run_path(target, run_name='__main__')
except Stop:
    truncated = True
except SystemExit:
    pass
except BaseException as e:
    tb = traceback.format_exception(type(e), e, e.__traceback__)
    error = ''.join(tb[-3:]).strip()
finally:
    sys.settrace(None)
    sys.stdout = real
print(json.dumps({'steps': steps, 'out': out.getvalue(), 'error': error, 'truncated': truncated, 'max': MAX}, ensure_ascii=False))
