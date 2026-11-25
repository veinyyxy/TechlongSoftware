import {readFileSync} from 'node:fs';
import pg from 'pg';
import {createRdsPostgresDatabase,readRdsControlDatabaseEnvironment,rdsControlPoolOptions} from '../../db/postgres-rds.ts';

const readCaBundle=()=>readFileSync('/app/certs/amazon-rds.pem','utf8');
export function createPool(options){
  const pool=new pg.Pool(options);
  pool.on('error',()=>console.error('SAAS_CONTROL_RDS_IDLE_CONNECTION_LOST'));
  return pool;
}

export function createSaasControlDatabaseBinding(environment,{readCa=readCaBundle,openPool=createPool}={}){
  let database;
  return ()=>{
    if(database)return database;
    const connection=readRdsControlDatabaseEnvironment(environment);
    if(!connection)return undefined;
    let ca;
    try{ca=readCa();}catch{throw Error('SAAS_CONTROL_RDS_CA_UNAVAILABLE');}
    database=createRdsPostgresDatabase(openPool(rdsControlPoolOptions(connection,ca)));
    return database;
  };
}
