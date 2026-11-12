import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/material.dart';
import 'screens/auth_gate.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Firebase.initializeApp(); // Run `flutterfire configure` to add firebase_options.dart if desired.
  runApp(const RishiidesDriverApp());
}

class RishiidesDriverApp extends StatelessWidget {
  const RishiidesDriverApp({super.key});
  @override
  Widget build(BuildContext context) => MaterialApp(
    title: 'Rishiides Driver', debugShowCheckedModeBanner: false,
    theme: ThemeData(colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF135D55)), useMaterial3: true, scaffoldBackgroundColor: const Color(0xFFF5F7F6)),
    home: const AuthGate(),
  );
}
