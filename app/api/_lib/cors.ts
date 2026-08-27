export const corsHeaders={'access-control-allow-origin':'https://ayyoub1616.github.io','access-control-allow-credentials':'true','access-control-allow-methods':'GET,POST,PATCH,DELETE,OPTIONS','access-control-allow-headers':'content-type,authorization'};
export const corsJson=(data:unknown,init?:ResponseInit)=>Response.json(data,{...init,headers:{...corsHeaders,...init?.headers}});
export const corsOptions=()=>new Response(null,{status:204,headers:corsHeaders});
