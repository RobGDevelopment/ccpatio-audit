/**
 * Self-contained WordPress shipping bridge plugin ZIP generator.
 * Pure Node zlib + CRC32 PKZIP — no external archive packages.
 */
import { deflateRawSync } from "node:zlib";

const PLUGIN_SLUG = "ccpatio-hub-shipping";
const PHP_PATH = `${PLUGIN_SLUG}/${PLUGIN_SLUG}.php`;
const README_PATH = `${PLUGIN_SLUG}/README.txt`;

/** CRC-32 (ISO 3309 / PNG / ZIP). */
export function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    crc ^= buf[i]!;
    for (let k = 0; k < 8; k += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(d = new Date()): { time: number; date: number } {
  const year = Math.max(1980, d.getFullYear());
  const time =
    ((d.getHours() & 0x1f) << 11) |
    ((d.getMinutes() & 0x3f) << 5) |
    ((Math.floor(d.getSeconds() / 2) & 0x1f) << 0);
  const date =
    (((year - 1980) & 0x7f) << 9) |
    (((d.getMonth() + 1) & 0xf) << 5) |
    (d.getDate() & 0x1f);
  return { time, date };
}

function u16(n: number): Buffer {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n >>> 0, 0);
  return b;
}

function u32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0, 0);
  return b;
}

type ZipEntry = {
  name: string;
  data: Buffer;
};

function buildLocalAndCentral(entries: ZipEntry[]): Buffer {
  const { time, date } = dosDateTime();
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, "utf8");
    const compressed = deflateRawSync(entry.data);
    const crc = crc32(entry.data);
    const method = 8; // deflate
    const gpFlag = 0;

    const local = Buffer.concat([
      u32(0x04034b50),
      u16(20), // version needed
      u16(gpFlag),
      u16(method),
      u16(time),
      u16(date),
      u32(crc),
      u32(compressed.length),
      u32(entry.data.length),
      u16(nameBuf.length),
      u16(0), // extra len
      nameBuf,
      compressed,
    ]);

    const central = Buffer.concat([
      u32(0x02014b50),
      u16(20), // version made by
      u16(20), // version needed
      u16(gpFlag),
      u16(method),
      u16(time),
      u16(date),
      u32(crc),
      u32(compressed.length),
      u32(entry.data.length),
      u16(nameBuf.length),
      u16(0), // extra
      u16(0), // comment
      u16(0), // disk start
      u16(0), // int attrs
      u32(0), // ext attrs
      u32(offset),
      nameBuf,
    ]);

    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }

  const localBlob = Buffer.concat(locals);
  const centralBlob = Buffer.concat(centrals);
  const end = Buffer.concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(centralBlob.length),
    u32(localBlob.length),
    u16(0),
  ]);

  return Buffer.concat([localBlob, centralBlob, end]);
}

export const CCPATIO_HUB_SHIPPING_PHP = `<?php
/**
 * Plugin Name: CC Patio Hub Shipping
 * Description: Bridges WooCommerce checkout to Hub Middleware POST /api/shipping/quote (FedEx LTL + showroom pickup) so TaxJar can tax (Subtotal + Shipping) before payment.
 * Version: 1.0.0
 * Author: CC Patio
 * Requires at least: 5.8
 * Requires PHP: 7.4
 * WC requires at least: 6.0
 * Text Domain: ccpatio-hub-shipping
 */

if ( ! defined( 'ABSPATH' ) ) {
        exit;
}

add_action( 'woocommerce_shipping_init', 'ccpatio_hub_shipping_init' );

function ccpatio_hub_shipping_init() {
        if ( ! class_exists( 'WC_Shipping_Method' ) ) {
                return;
        }

        class WC_CCPatio_Hub_Shipping_Method extends WC_Shipping_Method {
                public function __construct( $instance_id = 0 ) {
                        $this->id                 = 'ccpatio_hub_shipping';
                        $this->instance_id        = absint( $instance_id );
                        $this->method_title       = __( 'CC Patio Hub Freight', 'ccpatio-hub-shipping' );
                        $this->method_description = __( 'Live Hub LTL quotes (FedEx + showroom pickup) for TaxJar-accurate checkout.', 'ccpatio-hub-shipping' );
                        $this->supports           = array(
                                'shipping-zones',
                                'instance-settings',
                                'instance-settings-modal',
                        );
                        $this->init();
                }

                public function init() {
                        $this->init_form_fields();
                        $this->init_settings();
                        $this->title = $this->get_option( 'title', __( 'CC Patio Freight', 'ccpatio-hub-shipping' ) );
                        add_action(
                                'woocommerce_update_options_shipping_' . $this->id,
                                array( $this, 'process_admin_options' )
                        );
                }

                public function init_form_fields() {
                        $this->instance_form_fields = array(
                                'title'                   => array(
                                        'title'   => __( 'Method title', 'ccpatio-hub-shipping' ),
                                        'type'    => 'text',
                                        'default' => __( 'CC Patio Freight', 'ccpatio-hub-shipping' ),
                                ),
                                'hub_url'                 => array(
                                        'title'       => __( 'Hub URL', 'ccpatio-hub-shipping' ),
                                        'type'        => 'text',
                                        'description' => __( 'Base URL for Hub Middleware.', 'ccpatio-hub-shipping' ),
                                        'default'     => 'https://hub.ccpatio.com',
                                        'desc_tip'    => true,
                                ),
                                'shared_secret'           => array(
                                        'title'       => __( 'Shared secret', 'ccpatio-hub-shipping' ),
                                        'type'        => 'password',
                                        'description' => __( 'Sent as X-CCPatio-Shipping-Secret.', 'ccpatio-hub-shipping' ),
                                        'default'     => '',
                                        'desc_tip'    => true,
                                ),
                                'timeout_sec'             => array(
                                        'title'   => __( 'Timeout (seconds)', 'ccpatio-hub-shipping' ),
                                        'type'    => 'number',
                                        'default' => '6',
                                ),
                                'emergency_fallback_cost' => array(
                                        'title'   => __( 'Emergency fallback cost', 'ccpatio-hub-shipping' ),
                                        'type'    => 'price',
                                        'default' => '395.00',
                                ),
                        );
                }

                public function calculate_shipping( $package = array() ) {
                        $items = array();
                        if ( ! empty( $package['contents'] ) && is_array( $package['contents'] ) ) {
                                foreach ( $package['contents'] as $line ) {
                                        if ( empty( $line['data'] ) || ! is_object( $line['data'] ) ) {
                                                continue;
                                        }
                                        $product = $line['data'];
                                        if ( ! method_exists( $product, 'needs_shipping' ) || ! $product->needs_shipping() ) {
                                                continue;
                                        }
                                        $sku = method_exists( $product, 'get_sku' ) ? $product->get_sku() : '';
                                        if ( ! is_string( $sku ) || '' === trim( $sku ) ) {
                                                continue;
                                        }
                                        $qty = isset( $line['quantity'] ) ? (float) $line['quantity'] : 1;
                                        if ( $qty <= 0 ) {
                                                continue;
                                        }
                                        $items[] = array(
                                                'sku'      => $sku,
                                                'quantity' => $qty,
                                        );
                                }
                        }

                        if ( empty( $items ) ) {
                                return;
                        }

                        $dest = isset( $package['destination'] ) && is_array( $package['destination'] )
                                ? $package['destination']
                                : array();

                        $req = array(
                                'currency'    => function_exists( 'get_woocommerce_currency' ) ? get_woocommerce_currency() : 'USD',
                                'destination' => array(
                                        'country'     => isset( $dest['country'] ) ? $dest['country'] : 'US',
                                        'state'       => isset( $dest['state'] ) ? $dest['state'] : '',
                                        'postcode'    => isset( $dest['postcode'] ) ? $dest['postcode'] : '',
                                        'city'        => isset( $dest['city'] ) ? $dest['city'] : '',
                                        'address_1'   => isset( $dest['address'] ) ? $dest['address'] : ( isset( $dest['address_1'] ) ? $dest['address_1'] : '' ),
                                        'residential' => true,
                                ),
                                'items'       => $items,
                        );

                        $cache_key = 'ccp_ship_' . md5( wp_json_encode( $req ) );
                        $cached    = null;
                        if ( function_exists( 'WC' ) && WC()->session ) {
                                $cached = WC()->session->get( $cache_key );
                        }
                        if ( empty( $cached ) ) {
                                $cached = get_transient( $cache_key );
                        }

                        $body = null;
                        if ( is_array( $cached ) && ! empty( $cached['rates'] ) ) {
                                $body = $cached;
                        } else {
                                $hub_url = untrailingslashit( $this->get_option( 'hub_url', 'https://hub.ccpatio.com' ) );
                                $secret  = (string) $this->get_option( 'shared_secret', '' );
                                $timeout = max( 2, (int) $this->get_option( 'timeout_sec', 6 ) );
                                $url     = $hub_url . '/api/shipping/quote';

                                $response = wp_remote_post(
                                        $url,
                                        array(
                                                'timeout' => $timeout,
                                                'headers' => array(
                                                        'Content-Type'              => 'application/json',
                                                        'Accept'                    => 'application/json',
                                                        'X-CCPatio-Shipping-Secret'  => $secret,
                                                ),
                                                'body'    => wp_json_encode( $req ),
                                        )
                                );

                                if ( is_wp_error( $response ) ) {
                                        $fallback = (float) $this->get_option( 'emergency_fallback_cost', '395.00' );
                                        $this->add_rate(
                                                array(
                                                        'id'        => $this->get_rate_id( 'emergency_fallback' ),
                                                        'label'     => __( 'Freight (estimated — Hub unreachable)', 'ccpatio-hub-shipping' ),
                                                        'cost'      => $fallback,
                                                        'taxes'     => '',
                                                        'calc_tax'  => 'per_order',
                                                        'meta_data' => array(
                                                                '_ccpatio_quote_id'         => 'emergency',
                                                                '_ccpatio_pallet_count'     => 1,
                                                                '_ccpatio_total_weight_lbs' => 0,
                                                                '_ccpatio_rate_source'      => 'emergency_fallback',
                                                        ),
                                                )
                                        );
                                        return;
                                }

                                $code = (int) wp_remote_retrieve_response_code( $response );
                                $raw  = wp_remote_retrieve_body( $response );
                                $json = json_decode( $raw, true );
                                if ( $code < 200 || $code >= 300 || ! is_array( $json ) || empty( $json['rates'] ) ) {
                                        $fallback = (float) $this->get_option( 'emergency_fallback_cost', '395.00' );
                                        $this->add_rate(
                                                array(
                                                        'id'        => $this->get_rate_id( 'emergency_fallback' ),
                                                        'label'     => __( 'Freight (estimated — Hub unreachable)', 'ccpatio-hub-shipping' ),
                                                        'cost'      => $fallback,
                                                        'taxes'     => '',
                                                        'calc_tax'  => 'per_order',
                                                        'meta_data' => array(
                                                                '_ccpatio_quote_id'         => 'emergency',
                                                                '_ccpatio_pallet_count'     => 1,
                                                                '_ccpatio_total_weight_lbs' => 0,
                                                                '_ccpatio_rate_source'      => 'emergency_fallback',
                                                        ),
                                                )
                                        );
                                        return;
                                }

                                $body = $json;
                                if ( function_exists( 'WC' ) && WC()->session ) {
                                        WC()->session->set( $cache_key, $body );
                                }
                                set_transient( $cache_key, $body, 900 );
                        }

                        $quote_id     = isset( $body['quoteId'] ) ? (string) $body['quoteId'] : '';
                        $pallet_count = isset( $body['palletSummary']['palletCount'] ) ? (int) $body['palletSummary']['palletCount'] : 0;
                        $total_lbs    = isset( $body['palletSummary']['totalWeightLbs'] ) ? (float) $body['palletSummary']['totalWeightLbs'] : 0;

                        foreach ( $body['rates'] as $rate ) {
                                if ( ! is_array( $rate ) || empty( $rate['id'] ) ) {
                                        continue;
                                }
                                $cost     = isset( $rate['cost'] ) ? (float) $rate['cost'] : 0;
                                $taxable  = ! isset( $rate['taxable'] ) || false !== $rate['taxable'];
                                $label    = isset( $rate['label'] ) ? (string) $rate['label'] : (string) $rate['id'];
                                $source   = isset( $rate['rateSource'] ) ? (string) $rate['rateSource'] : '';

                                $this->add_rate(
                                        array(
                                                'id'        => $this->get_rate_id( (string) $rate['id'] ),
                                                'label'     => $label,
                                                'cost'      => $cost,
                                                // '' lets Woo/TaxJar compute shipping tax; false = tax-exempt pickup.
                                                'taxes'     => $taxable ? '' : false,
                                                'calc_tax'  => 'per_order',
                                                'meta_data' => array(
                                                        '_ccpatio_quote_id'         => $quote_id,
                                                        '_ccpatio_pallet_count'     => $pallet_count,
                                                        '_ccpatio_total_weight_lbs' => $total_lbs,
                                                        '_ccpatio_rate_source'      => $source,
                                                ),
                                        )
                                );
                        }
                }
        }
}

add_filter( 'woocommerce_shipping_methods', 'ccpatio_hub_shipping_add_method' );

function ccpatio_hub_shipping_add_method( $methods ) {
        if ( class_exists( 'WC_CCPatio_Hub_Shipping_Method' ) ) {
                $methods['ccpatio_hub_shipping'] = 'WC_CCPatio_Hub_Shipping_Method';
        }
        return $methods;
}
`;

export const CCPATIO_HUB_SHIPPING_README = `=== CC Patio Hub Shipping ===
Contributors: ccpatio
Requires at least: 5.8
Tested up to: 6.7
Requires PHP: 7.4
Stable tag: 1.0.0
License: Proprietary

Bridges WooCommerce checkout shipping to Hub Middleware (https://hub.ccpatio.com/api/shipping/quote).

== Setup ==
1. Upload and activate this plugin on ccpatiodev2.primeview.com (and production Woo).
2. WooCommerce → Settings → Shipping → add "CC Patio Hub Freight" to your zones.
3. Set Hub URL = https://hub.ccpatio.com
4. Set Shared secret = same value as Hub WOO_SHIPPING_QUOTE_SECRET (or WOOCOMMERCE_WEBHOOK_SECRET).
5. Enable TaxJar Professional in WooCommerce. Ship-from = Phoenix factory (85043). Nexus = AZ Scottsdale + CA Solana Beach.
6. Do NOT connect QuickBooks Online inside TaxJar — Hub passes exact TaxJar totals into QBO.

== Notes ==
* Taxable LTL freight uses taxes => '' so TaxJar taxes (Subtotal + Shipping).
* $0 showroom pickup uses taxes => false.
* Responses cache 900s in WC session + transient keyed by ccp_ship_{md5}.
* If Hub is unreachable, an emergency fallback rate (default $395) keeps checkout alive.
`;

export function buildCcpatioHubShippingZip(): Buffer {
  const php = Buffer.from(CCPATIO_HUB_SHIPPING_PHP, "utf8");
  const readme = Buffer.from(CCPATIO_HUB_SHIPPING_README, "utf8");
  return buildLocalAndCentral([
    { name: PHP_PATH, data: php },
    { name: README_PATH, data: readme },
  ]);
}

export function hubShippingZipFilename(): string {
  return "ccpatio-hub-shipping.zip";
}

export function hubShippingZipContainsPhp(zip: Buffer): boolean {
  const hay = zip.toString("binary");
  return (
    zip[0] === 0x50 &&
    zip[1] === 0x4b &&
    zip[2] === 0x03 &&
    zip[3] === 0x04 &&
    hay.includes(PHP_PATH)
  );
}
