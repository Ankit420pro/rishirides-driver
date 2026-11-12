import 'dart:io';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_storage/firebase_storage.dart';

class DriverService {
  final db = FirebaseFirestore.instance;
  final storage = FirebaseStorage.instance;
  final auth = FirebaseAuth.instance;

  Future<String> uploadDocument(File file, String uid, String type) async {
    final ref = storage.ref('driver_documents/$uid/$type');
    await ref.putFile(file);
    return ref.getDownloadURL();
  }

  Future<void> saveProfile({required String name, required String phone, required String email, required String licenceUrl, required String aadhaarUrl}) async {
    final user = auth.currentUser!;
    await db.collection('drivers').doc(user.uid).set({
      'uid': user.uid, 'name': name.trim(), 'phone': phone.trim(), 'email': email.trim().toLowerCase(),
      'licenceUrl': licenceUrl, 'aadhaarUrl': aadhaarUrl,
      'status': 'pending_approval', 'isOnline': false, 'location': null,
      'createdAt': FieldValue.serverTimestamp(), 'updatedAt': FieldValue.serverTimestamp(),
    }, SetOptions(merge: true));
    await db.collection('publicDrivers').doc(user.uid).set({'uid': user.uid, 'name': name.trim(), 'status': 'pending_approval', 'isOnline': false, 'createdAt': FieldValue.serverTimestamp()});
  }

  Stream<DocumentSnapshot<Map<String, dynamic>>> driver(String uid) => db.collection('drivers').doc(uid).snapshots();

  Future<void> setOnline(bool online) async {
    final uid = auth.currentUser!.uid;
    await db.collection('drivers').doc(uid).update({'isOnline': online, 'updatedAt': FieldValue.serverTimestamp()});
    await db.collection('publicDrivers').doc(uid).set({'isOnline': online, 'updatedAt': FieldValue.serverTimestamp()}, SetOptions(merge: true));
  }

  Future<void> updateLocation(double lat, double lng) async {
    final uid = auth.currentUser!.uid;
    await db.collection('drivers').doc(uid).update({'location': GeoPoint(lat, lng), 'locationUpdatedAt': FieldValue.serverTimestamp()});
    await db.collection('publicDrivers').doc(uid).set({'location': GeoPoint(lat, lng), 'locationUpdatedAt': FieldValue.serverTimestamp()}, SetOptions(merge: true));
  }

  Future<void> acceptRide(String rideId) async {
    final uid = auth.currentUser!.uid;
    await db.runTransaction((tx) async {
      final ref = db.collection('rides').doc(rideId);
      final snap = await tx.get(ref);
      if (!snap.exists || snap.data()?['status'] != 'requested') throw Exception('This ride is no longer available.');
      tx.update(ref, {'status': 'accepted', 'driverId': uid, 'acceptedAt': FieldValue.serverTimestamp()});
    });
  }

  Future<void> updateRideStatus(String rideId, String status) async {
    await db.collection('rides').doc(rideId).update({'status': status, 'updatedAt': FieldValue.serverTimestamp()});
  }
}
