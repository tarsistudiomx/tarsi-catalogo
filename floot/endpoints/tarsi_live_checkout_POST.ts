// floot:external
import {handleStorefront} from '../helpers/storefrontCheckout';
export const flootPublic = true;
export const handle = (request:Request) => handleStorefront(request,false);
