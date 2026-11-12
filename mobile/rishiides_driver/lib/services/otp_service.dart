import 'package:cloud_functions/cloud_functions.dart';

class OtpService {
  final _functions = FirebaseFunctions.instance;
  Future<void> send(String email) async {
    await _functions.httpsCallable('sendEmailOtp').call({'email': email.trim().toLowerCase()});
  }
  Future<void> verify(String email, String code) async {
    await _functions.httpsCallable('verifyEmailOtp').call({'email': email.trim().toLowerCase(), 'code': code.trim()});
  }
}
