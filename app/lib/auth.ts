const TOKEN_KEY='palletflow-access-token';
export const getAccessToken=()=>typeof sessionStorage==='undefined'?'':sessionStorage.getItem(TOKEN_KEY)||'';
export const saveAccessToken=(token:string)=>sessionStorage.setItem(TOKEN_KEY,token);
export const clearAccessToken=()=>sessionStorage.removeItem(TOKEN_KEY);
export const authFetch=(input:RequestInfo|URL,init:RequestInit={})=>{const headers=new Headers(init.headers),token=getAccessToken();if(token)headers.set('authorization',`Bearer ${token}`);return fetch(input,{...init,headers,credentials:'include'})};
