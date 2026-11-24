import 'dart:convert';
import 'buyer_runtime_binding.dart';

Future<void> main() async {
  const id = 'bbd626d7d3806af686073211';
  const buyer = 'https://app-$id.sandbox.techlong.cloud';
  const api = 'https://pending-app-$id.sandbox.techlong.cloud';
  final binding = {
    'schema': 'techlong/buyer-runtime/v1',
    'tenantId': 'app_$id',
    'buyerOrigin': buyer,
    'apiOrigin': api,
  };
  var fetches = 0;
  final selected = await resolveSandboxBuyerApi(
    Uri.parse('$buyer/payment-success'),
    (url) async {
      fetches++;
      if (url.toString() != '$buyer/buyer-runtime.json')
        throw StateError('wrong config origin');
      return jsonEncode(binding);
    },
  );
  if (fetches != 1 || selected.toString() != api)
    throw StateError('wrong tenant selected');
  Future<String> never(Uri _) => throw StateError('unexpected config fetch');
  if (await resolveSandboxBuyerApi(
            Uri.parse('https://buyer.sandbox.techlong.cloud/'),
            never,
          ) !=
          null ||
      await resolveSandboxBuyerApi(
            Uri.parse('https://example.invalid/'),
            never,
          ) !=
          null) {
    throw StateError('legacy behavior changed');
  }
  Future<void> rejects(Future<Uri?> action) async {
    try {
      await action;
    } on FormatException {
      return;
    }
    throw StateError('unexpected acceptance');
  }

  await rejects(
    resolveSandboxBuyerApi(
      Uri.parse('https://unknown.sandbox.techlong.cloud'),
      never,
    ),
  );
  for (final bad in [
    {
      ...binding,
      'apiOrigin': 'https://first-acceptance.sandbox.techlong.cloud',
    },
    {...binding, 'tenantId': 'app_${'0' * 24}'},
    {...binding, 'hmacKey': 'must not accept credentials'},
  ]) {
    await rejects(
      resolveSandboxBuyerApi(Uri.parse(buyer), (_) async => jsonEncode(bad)),
    );
  }
  final forwarded = sandboxBuyerForwardUri(
    '/api/orders/get_list',
    queryParameters: {'page': '1', 'test': 'a&b'},
  );
  if (forwarded.origin != 'https://console.sandbox.techlong.cloud' ||
      forwarded.path != '/api/buyer-forward/api/orders/get_list' ||
      forwarded.queryParameters['page'] != '1' ||
      forwarded.queryParameters['test'] != 'a&b') {
    throw StateError('forwarder origin, path, or query not preserved');
  }
  for (final invalid in [
    'https://other.invalid/api/orders/get_list',
    '//other.invalid/api/orders/get_list',
    '/api/../api/orders/get_list',
    '/api/%2E%2E/api/orders/get_list',
    '/api/orders/get_list?target=other.invalid',
    '/api/orders//get_list',
    '/api/orders/get_list\n',
  ]) {
    await rejects(Future<Uri?>.sync(() => sandboxBuyerForwardUri(invalid)));
  }
  print('Buyer runtime binding: passed');
}
