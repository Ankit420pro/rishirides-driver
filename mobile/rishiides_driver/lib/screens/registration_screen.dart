import 'dart:io';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import '../services/driver_service.dart';
import '../services/otp_service.dart';

class RegistrationScreen extends StatefulWidget {
  const RegistrationScreen({super.key});
  @override State<RegistrationScreen> createState() => _RegistrationScreenState();
}
class _RegistrationScreenState extends State<RegistrationScreen> {
  final _form = GlobalKey<FormState>();
  final name = TextEditingController(), phone = TextEditingController(), email = TextEditingController(), password = TextEditingController(), otp = TextEditingController();
  File? licence, aadhaar; bool otpSent = false, busy = false;
  final picker = ImagePicker(); final service = DriverService(); final otpService = OtpService();
  Future<void> pick(bool isLicence) async {
    final x = await picker.pickImage(source: ImageSource.gallery, imageQuality: 80);
    if (x != null) setState(() { if (isLicence) { licence = File(x.path); } else { aadhaar = File(x.path); } });
  }
  Future<void> sendOtp() async {
    if (!_form.currentState!.validate() || licence == null || aadhaar == null) { _message('Complete all fields and upload both documents.'); return; }
    setState(() => busy = true);
    try { await otpService.send(email.text); setState(() => otpSent = true); _message('OTP sent to your email address.'); }
    catch (e) { _message('Could not send OTP: $e'); } finally { setState(() => busy = false); }
  }
  Future<void> verifyAndRegister() async {
    setState(() => busy = true);
    try {
      await otpService.verify(email.text, otp.text);
      final credential = await FirebaseAuth.instance.createUserWithEmailAndPassword(email: email.text.trim(), password: password.text);
      final uid = credential.user!.uid;
      final licenceUrl = await service.uploadDocument(licence!, uid, 'driving_licence');
      final aadhaarUrl = await service.uploadDocument(aadhaar!, uid, 'aadhaar');
      await service.saveProfile(name: name.text, phone: phone.text, email: email.text, licenceUrl: licenceUrl, aadhaarUrl: aadhaarUrl);
      _message('Registration submitted. Wait for admin approval.');
    } catch (e) { _message('Registration failed: $e'); }
    finally { if (mounted) setState(() => busy = false); }
  }
  void _message(String s) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(s)));
  Widget field(String label, TextEditingController c, {TextInputType type = TextInputType.text, bool obscure = false}) => Padding(padding: const EdgeInsets.only(bottom: 12), child: TextFormField(controller: c, keyboardType: type, obscureText: obscure, decoration: InputDecoration(labelText: label, border: const OutlineInputBorder()), validator: (v) => v == null || v.trim().isEmpty ? 'Required' : null));
  @override void dispose() { name.dispose(); phone.dispose(); email.dispose(); password.dispose(); otp.dispose(); super.dispose(); }
  @override Widget build(BuildContext context) => Scaffold(body: SafeArea(child: Center(child: SingleChildScrollView(padding: const EdgeInsets.all(22), child: ConstrainedBox(constraints: const BoxConstraints(maxWidth: 480), child: Form(key: _form, child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
    const Icon(Icons.local_taxi, size: 54, color: Color(0xFF135D55)), const SizedBox(height: 10), const Text('RISHIIDES DRIVER', textAlign: TextAlign.center, style: TextStyle(fontSize: 25, fontWeight: FontWeight.bold)), const SizedBox(height: 6), const Text('Register to start accepting rides', textAlign: TextAlign.center), const SizedBox(height: 28),
    field('Full name', name), field('Phone number', phone, type: TextInputType.phone), field('Email address', email, type: TextInputType.emailAddress), field('Create password', password, obscure: true),
    OutlinedButton.icon(onPressed: () => pick(true), icon: const Icon(Icons.upload_file), label: Text(licence == null ? 'Upload driving licence' : 'Driving licence selected')),
    const SizedBox(height: 8), OutlinedButton.icon(onPressed: () => pick(false), icon: const Icon(Icons.badge), label: Text(aadhaar == null ? 'Upload Aadhaar card' : 'Aadhaar card selected')),
    const SizedBox(height: 18),
    if (!otpSent) FilledButton(onPressed: busy ? null : sendOtp, child: Text(busy ? 'Please wait…' : 'Send email OTP')),
    if (otpSent) ...[field('Enter 6-digit email OTP', otp, type: TextInputType.number), FilledButton(onPressed: busy ? null : verifyAndRegister, child: Text(busy ? 'Verifying…' : 'Verify OTP & register'))],
    const SizedBox(height: 12), const Text('Your documents are submitted securely for verification. Do not share your OTP or password.', textAlign: TextAlign.center, style: TextStyle(fontSize: 12, color: Colors.black54)),
  ]))))));
}
