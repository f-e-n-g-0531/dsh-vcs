import {existsSync} from 'node:fs';
export function opensslCommand(env=process.env,platform=process.platform){
 if(env.OPENSSL_BIN)return env.OPENSSL_BIN;
 if(platform==='win32')for(const candidate of ['D:/Programs/Scoop/apps/git/current/usr/bin/openssl.exe','C:/Program Files/Git/usr/bin/openssl.exe','C:/Program Files/OpenSSL-Win64/bin/openssl.exe'])if(existsSync(candidate))return candidate;
 return 'openssl';
}
export function chromeCommand(env=process.env,platform=process.platform){
 if(env.CHROME_BIN)return env.CHROME_BIN;
 // Same default as scripts/run-monaco-browser.mjs: PATH-selected google-chrome.
 return 'google-chrome';
}
