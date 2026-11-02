import {spawnSync} from 'node:child_process';
import {opensslCommand,chromeCommand} from './test-tools.mjs';
import {pathToFileURL} from 'node:url';
export function probeTools({browser=false,env=process.env,run=spawnSync}={}) {
  const tools={node:process.version};
  if(Number(process.versions.node.split('.')[0])<22)throw Error('Tool preflight: Node >=22 required');
  const commands=[['git','git',['--version']],['svn','svn',['--version','--quiet']],['svnadmin','svnadmin',['--version','--quiet']],['openssl',opensslCommand(env),['version']]];
  if(browser)commands.push(['chrome',chromeCommand(env),['--version']],['python','python3',['--version']],['apache','apache2',['-v']]);
  for(const [name,command,args] of commands){
    const result=run(command,args,{encoding:'utf8',windowsHide:true,timeout:10000,maxBuffer:65536,shell:false});
    if(result.error||result.status!==0)throw Error('Tool preflight: '+name+' unavailable ('+command+'): '+(result.error?.code||'exit '+result.status));
    const version=(result.stdout||result.stderr||'').trim();if(!version)throw Error('Tool preflight: '+name+' did not report a version');tools[name]=version.slice(0,512);
  }
  return tools;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  if(process.argv.slice(2).some(a=>a!=='--browser'))throw Error('Usage: node scripts/test-preflight.mjs [--browser]');
  console.log(JSON.stringify(probeTools({browser:process.argv.includes('--browser')}),null,2));
}
