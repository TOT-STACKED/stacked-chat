import profiles from './data/profiles.json';
import supportUrls from './data/support-urls.json';
import vendorNames from './data/vendor-names.json';

/**
 * Stacked's hospitality-technology support playbook, maintained by Stacked (not by customers).
 * Ported from the old chat. profiles: detailed troubleshooting for the main vendors (key = lower-case name);
 * supportUrls: where to get help for ~100 vendors; vendorNames: the ~225 products we recognise by name.
 */
export const PROFILES: Record<string, string> = profiles;
export const SUPPORT_URLS: Record<string, string> = supportUrls;
export const VENDOR_NAMES: string[] = vendorNames;

/** The kinds of system a venue can record, so the assistant never asks "which till do you use?" when it is known. */
export const TECH_CATEGORIES: Array<[string, string]> = [
  ['epos', 'EPOS / till'], ['payments', 'Payment terminals'], ['reservations', 'Reservations'], ['rota', 'Rota / workforce'],
  ['ordering', 'Online ordering and delivery'], ['loyalty', 'Loyalty / CRM'], ['inventory', 'Inventory / procurement'], ['pms', 'Hotel PMS'], ['wifi', 'Wi-Fi'],
];
