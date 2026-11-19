// floot:external
import {handleStorefront} from '../helpers/storefrontCheckout';
export const flootPreviewPublic = true;
export const handle = (request:Request) => handleStorefront(request,true);
