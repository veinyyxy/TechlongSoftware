import 'dart:convert';

const sandboxBuyerRuntimePath = '/buyer-runtime.json';
const _sandboxBuyerForwardHost = 'console.sandbox.techlong.cloud';
const _sandboxBuyerForwardPrefix = '/api/buyer-forward';
const _suffix = '.sandbox.techlong.cloud';
const _legacyBuyer = 'buyer.sandbox.techlong.cloud';
final _tenantHost = RegExp(r'^app-([a-f0-9]{24})\.sandbox\.techlong\.cloud$');
final _apiPath = RegExp(r'^/api/[a-zA-Z0-9_-]+(?:/[a-zA-Z0-9_-]+)*$');

/// The browser sends buyer requests only to the fixed server-owned forwarder.
/// The exact Origin is supplied by the browser; no caller-selected tenant,
/// upstream origin or signing material travels in this URL.
Uri sandboxBuyerForwardUri(
  String path, {
  Map<String, String>? queryParameters,
}) {
  if (path.length > 512 || _apiPath.matchAsPrefix(path)?.end != path.length) {
    throw const FormatException('Invalid Sandbox buyer API path.');
  }
  return Uri.https(
    _sandboxBuyerForwardHost,
    '$_sandboxBuyerForwardPrefix$path',
    queryParameters,
  );
}

/// New tenant origins are runtime data, never a dart-define per tenant. The
/// legacy tester and non-Sandbox targets keep their previous build-time path.
/// A broken or unknown Sandbox binding may not fall back to that path.
Future<Uri?> resolveSandboxBuyerApi(
  Uri page,
  Future<String> Function(Uri configUrl) fetch,
) async {
  final host = page.host;
  if (!host.endsWith(_suffix)) return null;
  if (page.scheme != 'https' || page.port != 443 || page.userInfo.isNotEmpty) {
    throw const FormatException('Invalid Sandbox buyer origin.');
  }
  if (host == _legacyBuyer) return null;
  final match = _tenantHost.firstMatch(host);
  if (match == null) throw const FormatException('Unknown Sandbox buyer host.');

  final id = match.group(1)!;
  final buyer = 'https://$host';
  final api = 'https://pending-$host';
  final json = await fetch(Uri.parse('$buyer$sandboxBuyerRuntimePath'));
  if (json.length > 2048)
    throw const FormatException('Buyer binding is too large.');
  final binding = jsonDecode(json);
  if (binding is! Map<String, dynamic> ||
      binding.length != 4 ||
      binding['schema'] != 'techlong/buyer-runtime/v1' ||
      binding['tenantId'] != 'app_$id' ||
      binding['buyerOrigin'] != buyer ||
      binding['apiOrigin'] != api) {
    throw const FormatException('Buyer binding does not match this origin.');
  }
  return Uri.parse(api);
}
