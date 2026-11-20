import path from 'node:path';
import {realpath,stat} from 'node:fs/promises';
import {runBoundedProcess} from './bounded-process.mjs';

// Run the official provider in an isolated process. The only secret-bearing IPC
// is the bounded private stdout pipe; never inherit a shell or print its output.
const provider = String.raw`
import ctypes as c, json, os, pathlib, sys, winreg
P=c.c_void_p
class Simple(c.Structure):
    _fields_=[('username',c.c_char_p),('password',c.c_char_p),('may_save',c.c_int)]
def bind(lib,name,result,*args):
    f=getattr(lib,name); f.argtypes=args; f.restype=result; return f
def lookup(realm):
    with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE,r'SOFTWARE\TortoiseSVN',0,winreg.KEY_READ|winreg.KEY_WOW64_64KEY) as key:
        directory=pathlib.Path(winreg.QueryValueEx(key,'Directory')[0].strip())/'bin'
    if not directory.is_absolute(): return None
    config=os.environ.get('APPDATA')
    if not config or not pathlib.Path(config).is_absolute(): return None
    with os.add_dll_directory(str(directory)):
        apr=c.CDLL(str(directory/'libapr_tsvn.dll')); svn=c.CDLL(str(directory/'libsvn_tsvn.dll'))
        if bind(apr,'apr_initialize',c.c_int)()!=0: return None
        pool=P()
        try:
            if bind(apr,'apr_pool_create_ex',c.c_int,c.POINTER(P),P,P,P)(c.byref(pool),None,None,None)!=0: return None
            obj=P(); err=bind(svn,'svn_auth_get_platform_specific_provider',P,c.POINTER(P),c.c_char_p,c.c_char_p,P)(c.byref(obj),b'windows',b'simple',pool)
            if err or not obj.value: return None
            providers=bind(apr,'apr_array_make',P,P,c.c_int,c.c_int)(pool,1,c.sizeof(P))
            c.cast(bind(apr,'apr_array_push',P,P)(providers),c.POINTER(P))[0]=obj
            auth=P(); bind(svn,'svn_auth_open',None,c.POINTER(P),P,P)(c.byref(auth),providers,pool)
            opts=bind(svn,'svn_auth_set_parameter',None,P,c.c_char_p,P)
            cfg=c.create_string_buffer(os.fsencode(pathlib.Path(config)/'Subversion'))
            for name in (b'svn:auth:config-dir',b'svn:auth:non-interactive',b'svn:auth:no-auth-cache'):
                opts(auth,name,c.cast(cfg,P))
            cred=P(); state=P()
            err=bind(svn,'svn_auth_first_credentials',P,c.POINTER(P),c.POINTER(P),c.c_char_p,c.c_char_p,P,P)(c.byref(cred),c.byref(state),b'svn.simple',realm,auth,pool)
            if err or not cred.value: return None
            answer=c.cast(cred,c.POINTER(Simple)).contents
            if not answer.username or not answer.password or len(answer.username)>256 or len(answer.password)>1024: return None
            return dict(username=answer.username.decode('utf-8'),password=answer.password.decode('utf-8'))
        finally:
            if pool.value: bind(apr,'apr_pool_destroy',None,P)(pool)
            bind(apr,'apr_terminate',None)()
try:
    result=lookup(sys.argv[1].encode('ascii'))
    if result is not None: print(json.dumps(result))
except Exception:
    sys.exit(1)
`;

export async function readWindowsSvnCache(realm,{signal}={}) {
  if (process.platform !== 'win32' || !/^<https:\/\/[A-Za-z0-9.-]+:[0-9]{1,5}> [\x20-\x7e]{1,512}$/.test(realm)) return undefined;
  const {APPDATA, SystemRoot, PATH} = Object.fromEntries(['APPDATA','SystemRoot','PATH'].map(key=>[key,Object.entries(process.env).find(([name])=>name.toLowerCase()===key.toLowerCase())?.[1]]));
  if (!APPDATA || !SystemRoot || !PATH) return undefined;
  // Ignore relative PATH entries and the Store alias; resolve against host PATH only.
  let executable;
  for (const directory of PATH.split(path.delimiter)) {
    if (!/^[A-Za-z]:[\\/]/.test(directory) || /[\\/]WindowsApps(?:[\\/]|$)/i.test(directory)) continue;
    signal?.throwIfAborted();
    try {
      const candidate=await realpath(path.join(directory,'python.exe'));
      if ((await stat(candidate)).isFile()) { executable=candidate; break; }
    } catch {}
  }
  if (!executable) return undefined;
  // No Python startup hooks, inherited proxy/credential variables or worktree cwd.
  const output=await runBoundedProcess(executable,['-I','-S','-c',provider,realm],{
    cwd:path.join(SystemRoot,'System32'),env:{APPDATA,SystemRoot,PATH},signal,maxBytes:8192,timeoutMs:4000,
  });
  try { return output.length ? JSON.parse(output.toString('utf8')) : undefined; }
  finally {output.fill(0);}
}
