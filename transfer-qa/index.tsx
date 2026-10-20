import 'react-native-gesture-handler';
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { registerRootComponent, requireNativeModule } from 'expo';
import { Directory, File, Paths } from 'expo-file-system';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { NavigationContainer, useNavigation, type NavigationProp } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { Pin } from 'lucide-react-native';
import { StopCompassCard } from '../src/components/StopCompassCard';
import { ConnectionSummary } from '../src/components/ConnectionSummary';
import { LegTimeline } from '../src/components/LegTimeline';
import { NavMiniMap } from '../src/components/NavMiniMap';
import { scheme } from '../src/theme/tokens';
import { setLocaleInternal } from '../src/i18n/locale';
import { useStrings } from '../src/i18n';
import { computeTripProgress } from '../src/services/notifications/tripProgress';
import { buildLivePlan } from '../src/services/notifications/content';
import { getTransferNativeCopy } from '../src/services/notifications/transferCopy';
import type { TransferProtectionState } from '../src/services/notifications/transferTypes';
import type { Connection, LegStop } from '../src/types/models';
import fixture from './fixture.json';

setLocaleInternal('pl', 'pl');
const native = requireNativeModule<{
  startTrip(json: string): Promise<boolean>;
  stopTrip(): Promise<boolean>;
  configureTransferProtection(id: string, path: string): Promise<boolean>;
  getTransferProtectionState(): Promise<string | null>;
}>('KilometrTracking');
const Stack = createNativeStackNavigator();
const clock = (sec: number) => `${String(Math.floor(sec / 3600) % 24).padStart(2, '0')}:${String(Math.floor(sec / 60) % 60).padStart(2, '0')}`;
let current: Connection;

function prepare() {
  const root = JSON.parse(JSON.stringify(fixture));
  const now = Date.now();
  const baseMs = new Date(now).setHours(0, 0, 0, 0);
  const offset = Math.floor((now - baseMs) / 1000) - 540;
  const shift = offset - root.offset;
  root.offset = offset;
  root.baseMs = baseMs;
  root.validUntilMs = now + 10_800_000;
  root.copy = getTransferNativeCopy();
  const binary = Uint8Array.from(atob(root.networkBase64), c => c.charCodeAt(0));
  delete root.networkBase64;
  const view = new DataView(binary.buffer);
  const integer = (word: number) => view.getInt32(word * 4, true);
  const patternCount = integer(4);
  let word = 7 + integer(2) + 1 + integer(3) * 3 + integer(5) + 1 + integer(6) * 2;
  const tripStops = new Map<string, LegStop[]>();
  for (let p = 0; p < patternCount; p++) {
    const n = integer(word + 1), count = integer(word + 2);
    word += 3;
    const stopIndices = Array.from({length:n}, (_,i)=>integer(word+i));
    word += n;
    for (let i = 0; i < n * count * 2; i++) view.setInt32((word+i)*4, integer(word+i)+shift, true);
    for (let j = 0; j < count; j++) {
      tripStops.set(root.patterns[p].trips[j], stopIndices.map((index,i)=>({
        stopId:root.stops[index].id, name:root.stops[index].name, lat:root.stops[index].lat, lon:root.stops[index].lon,
        seq:i, departSec:integer(word+j*n+i), arriveSec:integer(word+n*count+j*n+i),
      })));
    }
    word += n * count * 2;
  }
  const connection = root.connection as Connection;
  connection.departureSec += shift;
  connection.departAt = clock(connection.departureSec);
  connection.legs = connection.legs.map(leg=>{
    const stops = tripStops.get(leg.tripId!)!;
    const a = stops.findIndex(s=>s.stopId===leg.fromStopId), b = stops.findIndex(s=>s.stopId===leg.toStopId);
    return {...leg, departAt:clock(stops[a].departSec!), arriveAt:clock(stops[b].arriveSec!), intermediateStops:stops.slice(a,b+1)};
  });
  connection.arriveAt = connection.legs.at(-1)!.arriveAt;
  root.timeline = connection.legs.map(leg=>{
    const stops=tripStops.get(leg.tripId!)!;
    return {departMs:baseMs+stops.find(s=>s.stopId===leg.fromStopId)!.departSec!*1000,
      arriveMs:baseMs+stops.find(s=>s.stopId===leg.toStopId)!.arriveSec!*1000};
  });
  return { root, binary, now, connection };
}

function Trip() {
  const s = useStrings();
  const navigation = useNavigation<NavigationProp<{trip: undefined; map: undefined}>>();
  const seed = useMemo(prepare, []);
  const [connection, setConnection] = useState(seed.connection);
  const [state, setState] = useState<TransferProtectionState>();
  const [active, setActive] = useState(false);
  const [busy, setBusy] = useState(false);
  current = connection;
  useEffect(()=>{
    const timer=setInterval(()=>{void native.getTransferProtectionState().then(json=>{
      if(!json)return;
      const next=JSON.parse(json) as TransferProtectionState;
      setState(next);
      if(next.connection)setConnection(next.connection);
      console.log('TRANSFER_QA',next.status,next.revision,next.delaySec,next.nextLine,next.transferStop);
    })},1000);
    return()=>clearInterval(timer);
  },[]);
  const toggle=async()=>{
    if(busy)return;
    setBusy(true);
    try {
      if(active){await native.stopTrip();setActive(false);setState(undefined);return;}
      await Notifications.requestPermissionsAsync();
      await Location.requestForegroundPermissionsAsync();
      const dir=new Directory(Paths.document,'transfer-qa',String(seed.now));dir.create({intermediates:true,idempotent:true});
      const network=new File(dir,'network.bin');network.write(seed.binary);
      seed.root.networkPath=network.uri;
      const file=new File(dir,'context.json');file.write(JSON.stringify(seed.root));
      const trip={id:connection.id,fromTitle:connection.fromTitle,fromLat:51,fromLon:17,toId:'E',toTitle:'Cel',toLat:51,toLon:17.04,
        connection,startedAt:Date.now(),protectionEnabled:true};
      const plan=buildLivePlan(computeTripProgress(connection),connection,trip,s);
      console.log('TRANSFER_QA start',await native.startTrip(JSON.stringify(plan)));
      await new Promise(resolve=>setTimeout(resolve,500));
      console.log('TRANSFER_QA configured',await native.configureTransferProtection(connection.id,file.uri));
      await native.startTrip(JSON.stringify(plan));setActive(true);
    }finally{setBusy(false)}
  };
  return <SafeAreaView style={{flex:1,backgroundColor:scheme.surface}}>
    <View style={{flexDirection:'row',padding:16,gap:12,alignItems:'center'}}>
      <Text style={{flex:1,color:scheme.onSurface,fontSize:18,fontWeight:'600'}}>{s.routeDetails.title}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={active?s.routes.stopTrackingTripA11y:s.routes.trackTripA11y}
        disabled={busy} onPress={()=>void toggle()} style={{width:48,height:48,borderRadius:12,backgroundColor:active?scheme.primaryContainer:scheme.surfaceContainer,alignItems:'center',justifyContent:'center'}}>
        {busy?<ActivityIndicator/>:<Pin size={22} color={active?scheme.onPrimaryContainer:scheme.onSurfaceVariant}/>}
      </Pressable>
    </View>
    <ScrollView contentContainerStyle={{padding:16,gap:16}}>
      <Text style={{color:scheme.onSurfaceVariant,fontSize:12}}>Dane testowe · symulacja GPS</Text>
      <ConnectionSummary item={connection} offline={false}/>
      <LegTimeline legs={connection.legs}/>
      <StopCompassCard connection={connection} transfer={active?state:undefined} onOpenMap={()=>navigation.navigate('map')}/>
    </ScrollView>
  </SafeAreaView>;
}
function MapScreen(){return <SafeAreaView style={{flex:1,backgroundColor:scheme.surface}}><NavMiniMap
  path={current.legs.flatMap(leg=>(leg.intermediateStops??[]).map(stop=>[stop.lat!,stop.lon!] as [number,number]))}
  user={null} stop={[current.legs[0].toLat!,current.legs[0].toLon!]} headingDeg={null} accuracyM={null}
  accent={scheme.primary} style={{flex:1}}/></SafeAreaView>}
function App(){return <GestureHandlerRootView style={{flex:1}}><SafeAreaProvider><NavigationContainer>
  <Stack.Navigator><Stack.Screen name="trip" component={Trip} options={{headerShown:false}}/>
    <Stack.Screen name="map" component={MapScreen}/></Stack.Navigator>
</NavigationContainer></SafeAreaProvider></GestureHandlerRootView>}
registerRootComponent(App);
