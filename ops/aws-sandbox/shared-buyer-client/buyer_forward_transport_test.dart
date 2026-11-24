// Run with the buyer overlay applied and a local package config (offline).
// The HTTP sender is substituted; the series operates on the actual ApiService.
import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:speedfeast/Controller/api_service.dart';

void require(bool condition, String message) {
  if (!condition) throw StateError(message);
}

class RecordingClient extends http.BaseClient {
  final calls = <({http.BaseRequest request, String body})>[];

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    calls.add((request: request, body: await request.finalize().bytesToString()));
    return http.StreamedResponse(
      Stream.value(utf8.encode('{"success":true}')),
      200,
      headers: {'content-type': 'application/json'},
      request: request,
    );
  }
}

Future<void> main() async {
  final client = RecordingClient();
  await http.runWithClient(() async {
    final tenant = ApiService(
      'https://pending-app-bbd626d7d3806af686073211.sandbox.techlong.cloud',
      useSandboxBuyerForward: true,
    );
    tenant.setStoreId('store-fixture');
    tenant.setBuyerDeviceContext(deviceId: 'buyer-device-fixture', platform: 'web');
    await tenant.get('/api/orders/get_list', queryParameters: {'page': 2}, token: 'fixture');
    await tenant.post('/api/orders/create', {'amount': 12.0}, token: 'fixture');
    final legacy = ApiService('https://first-acceptance.sandbox.techlong.cloud');
    await legacy.get('/api/stores/bootstrap');
  }, () => client);

  require(client.calls.length == 3, 'unexpected retries or fallback requests');
  for (final call in client.calls.take(2)) {
    final request = call.request;
    final headers = request.headers.map((key, value) => MapEntry(key.toLowerCase(), value));
    require(request.url.origin == 'https://console.sandbox.techlong.cloud', 'wrong transport origin');
    require(!request.followRedirects, 'forwarded request must not follow a redirect');
    require(headers['authorization'] == 'Bearer fixture', 'buyer bearer missing');
    require(headers['x-store-id'] == 'store-fixture', 'store context missing');
    require(headers['x-buyer-device-id'] == 'buyer-device-fixture', 'device context missing');
    require(headers['x-buyer-platform'] == 'web', 'buyer platform context missing');
    require(!headers.keys.any({
      'cookie', 'x-client-id', 'x-timestamp', 'x-nonce', 'x-signature',
    }.contains), 'legacy signing or cookie headers must not be forwarded');
  }
  final get = client.calls.first;
  require(get.request.method == 'GET' &&
      get.request.url.path == '/api/buyer-forward/api/orders/get_list' &&
      get.request.url.queryParameters['page'] == '2' && get.body.isEmpty,
      'GET method/path/query drifted');
  final post = client.calls[1];
  require(post.request.method == 'POST' &&
      post.request.url.path == '/api/buyer-forward/api/orders/create' &&
      post.body == '{"amount":12}' &&
      post.request.headers['content-type'] == 'application/json',
      'normalized POST bytes, route or type drifted');
  final legacy = client.calls.last.request;
  require(legacy.url.toString() == 'https://first-acceptance.sandbox.techlong.cloud/api/stores/bootstrap' &&
      legacy.headers['x-client-id'] == 'fixture-client-id' &&
      (legacy.headers['x-signature'] ?? '').isNotEmpty && legacy.followRedirects,
      'legacy client no longer uses its untouched direct origin/signature path');
  print('Buyer forward transport: passed');
}
