import 'dart:async';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:intl/intl.dart';
import '../services/driver_service.dart';

class DashboardScreen extends StatefulWidget { const DashboardScreen({super.key}); @override State<DashboardScreen> createState() => _DashboardScreenState(); }
class _DashboardScreenState extends State<DashboardScreen> {
  final service = DriverService(); StreamSubscription<Position>? positionSub; bool online = false; GoogleMapController? map;
  static const start = LatLng(30.0869, 78.2676); // Rishikesh fallback; actual GPS replaces it.
  @override void initState() { super.initState(); _loadStatus(); }
  Future<void> _loadStatus() async { final d = await FirebaseFirestore.instance.collection('drivers').doc(FirebaseAuth.instance.currentUser!.uid).get(); if (!mounted) return; setState(() => online = d.data()?['isOnline'] == true); }
  Future<void> _toggle(bool v) async {
    if (v) {
      var permission = await Geolocator.checkPermission(); if (permission == LocationPermission.denied) permission = await Geolocator.requestPermission();
      if (permission == LocationPermission.denied || permission == LocationPermission.deniedForever) { _toast('Location permission is required to receive nearby rides.'); return; }
      if (!await Geolocator.isLocationServiceEnabled()) { _toast('Please enable device location.'); return; }
      positionSub = Geolocator.getPositionStream(locationSettings: const LocationSettings(accuracy: LocationAccuracy.high, distanceFilter: 10)).listen((p) { service.updateLocation(p.latitude, p.longitude); });
    } else { await positionSub?.cancel(); positionSub = null; }
    await service.setOnline(v); if (mounted) setState(() => online = v);
  }
  void _toast(String s) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(s)));
  double _distance(GeoPoint a, GeoPoint b) => Geolocator.distanceBetween(a.latitude, a.longitude, b.latitude, b.longitude) / 1000;
  @override void dispose() { positionSub?.cancel(); super.dispose(); }
  @override Widget build(BuildContext context) {
    final uid = FirebaseAuth.instance.currentUser!.uid;
    return Scaffold(appBar: AppBar(title: const Text('Rishiides Driver'), actions: [IconButton(onPressed: () async { await FirebaseAuth.instance.signOut(); }, icon: const Icon(Icons.logout))]),
      body: StreamBuilder<DocumentSnapshot<Map<String, dynamic>>>(stream: service.driver(uid), builder: (context, driverSnap) {
        final driver = driverSnap.data?.data() ?? {}; final approved = driver['status'] == 'approved'; final point = driver['location'] as GeoPoint?;
        return ListView(padding: const EdgeInsets.all(16), children: [
          Card(child: Padding(padding: const EdgeInsets.all(16), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text('Hello, ${driver['name'] ?? 'Driver'}', style: const TextStyle(fontSize: 21, fontWeight: FontWeight.bold)), const SizedBox(height: 8), Text(approved ? 'Account approved' : 'Account: ${driver['status'] ?? 'pending_approval'}'), if (!approved) const Text('You can go online after admin approval.'), SwitchListTile(contentPadding: EdgeInsets.zero, title: Text(online ? 'You are online' : 'You are offline'), value: online, onChanged: approved ? _toggle : null)]))),
          SizedBox(height: 210, child: ClipRRect(borderRadius: BorderRadius.circular(16), child: GoogleMap(initialCameraPosition: CameraPosition(target: point == null ? start : LatLng(point.latitude, point.longitude), zoom: 14), myLocationEnabled: true, myLocationButtonEnabled: true, onMapCreated: (c) => map = c))),
          const SizedBox(height: 18), const Text('Nearby ride requests', style: TextStyle(fontSize: 19, fontWeight: FontWeight.bold)),
          if (!online || !approved) const Padding(padding: EdgeInsets.all(18), child: Text('Get approved and go online to receive ride requests.')),
          if (online && approved) StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(stream: FirebaseFirestore.instance.collection('rides').where('status', isEqualTo: 'requested').snapshots(), builder: (context, snap) {
            if (!snap.hasData) return const Center(child: CircularProgressIndicator());
            final rides = snap.data!.docs.where((r) { final p = r.data()['pickup'] as GeoPoint?; return p != null && point != null && _distance(point, p) <= 10; }).toList();
            if (rides.isEmpty) return const Padding(padding: EdgeInsets.all(18), child: Text('No nearby rides right now.'));
            return Column(children: rides.map((r) { final d = r.data(); final pickup = d['pickup'] as GeoPoint; return Card(child: ListTile(title: Text('Ride • ${(_distance(point!, pickup)).toStringAsFixed(1)} km away'), subtitle: Text('${d['pickupAddress'] ?? 'Pickup location'}\nFare: ₹${d['fare'] ?? '—'}'), isThreeLine: true, trailing: FilledButton(onPressed: () async { try { await service.acceptRide(r.id); _toast('Ride accepted'); } catch (e) { _toast('$e'); } }, child: const Text('Accept')))); }).toList());
          }),
          const SizedBox(height: 18), const Text('Earnings', style: TextStyle(fontSize: 19, fontWeight: FontWeight.bold)),
          StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(stream: FirebaseFirestore.instance.collection('rides').where('driverId', isEqualTo: uid).where('status', isEqualTo: 'completed').snapshots(), builder: (context, snap) {
            final docs = snap.data?.docs ?? []; final total = docs.fold<double>(0, (sum, r) => sum + ((r.data()['driverEarning'] ?? r.data()['fare'] ?? 0) as num).toDouble());
            return Card(child: Padding(padding: const EdgeInsets.all(16), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text('₹${total.toStringAsFixed(2)}', style: const TextStyle(fontSize: 28, fontWeight: FontWeight.bold)), const Text('All-time completed ride earnings'), Text('${docs.length} completed rides')])));
          }),
        ]);
      }));
  }
}
