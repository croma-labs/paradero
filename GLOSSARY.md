# Paradero

Paradero tells Bogotá riders where their bus is and when it will reach their stop. It covers every System in the city's public network, and it reads the rider's TuLlave card. Terms are in English. The _Spanish_ line gives the words riders see and the words developers use when they talk in Spanish.

## Network

**SITP**:
Bogotá's whole integrated public transport network: every System together.
_Spanish_: SITP, el sistema integrado
_Avoid_: SITP (when meaning only the blue Zonal buses), TransMilenio (when meaning the whole network)

**System**:
One of the transport systems that make up the SITP, each with its own Vehicles, Stops and Fares.
_Spanish_: sistema, componente
_Avoid_: mode, network

**Trunk**:
The BRT System: red buses on dedicated corridors that stop only at Stations and Portals.
_Spanish_: troncal, TransMilenio
_Avoid_: TransMilenio (in code and docs, where it is ambiguous with TransMilenio S.A.), BRT

**Shuttle**:
The System of buses that loop from a Portal or Station through nearby neighbourhoods and back, at no extra Fare.
_Spanish_: alimentador
_Avoid_: feeder, connector

**Zonal**:
The System of blue buses that run on ordinary streets and stop at Street Stops.
_Spanish_: zonal, zonal urbano, SITP (as riders say it)
_Avoid_: SITP (in code and docs), urban

**Complementary**:
The System of orange buses that link areas of the city with each other and with the Trunk.
_Spanish_: complementario
_Avoid_: orange bus

**Dual**:
The System of buses that run both on Trunk corridors, stopping at Stations, and on ordinary streets, stopping at Street Stops.
_Spanish_: dual
_Avoid_: hybrid

**TransMiCable**:
The cable car System, whose cabins run between their own Stations.
_Spanish_: TransMiCable, cable
_Avoid_: gondola, aerial cable

**Special**:
The System of routes that reach hard-to-serve neighbourhoods, such as hillsides at the edge of the city.
_Spanish_: especial, zonal especial
_Avoid_: especial (when it tags a Route's Sunday or holiday path; that is a Detour)

## Stops

**Stop**:
Any place where a rider can board or leave a Vehicle, in any System. Every Stop is a Station, a Portal or a Street Stop.
_Spanish_: paradero
_Avoid_: parada; "station" when meaning any stop

**Station**:
An enclosed Stop where riders pay at a turnstile on the way in. One Station can serve more than one System.
_Spanish_: estación
_Avoid_: TransMilenio station (a Station is not tied to one System)

**Portal**:
A large Station at the end of a Trunk corridor, where Trunk routes meet Shuttles.
_Spanish_: portal
_Avoid_: terminal

**Street Stop**:
A Stop on the side of the street, with no turnstile, where riders pay on board.
_Spanish_: paradero SITP
_Avoid_: bus stop, parada

**Accessible**:
A Stop that a rider in a wheelchair can board from. It is a property of a Stop, not a kind of Stop.
_Spanish_: accesible
_Avoid_: handicap, disabled-friendly

## Routes

**Route**:
A service that runs between two ends of the city in both Directions, and that riders know by its Route Codes.
_Spanish_: ruta
_Avoid_: line, service

**Direction**:
One of the two ways a Route runs.
_Spanish_: sentido
_Avoid_: way, heading, pattern

**Detour**:
A temporary change to the path a Route runs, either planned, like the Sunday Ciclovía, or unplanned, like a closed street. The Route keeps its Route Codes.
_Spanish_: desvío
_Avoid_: variant, twin, Sunday route

**Route Code**:
The code painted on a Vehicle. On some Routes, each Direction has its own Route Code; its letter marks the Direction, as in K635 and H635.
_Spanish_: código de la ruta
_Avoid_: route number, route name

**Feed Code**:
The single code the Transit Feed uses for a Route whose Directions have separate Route Codes, as in HK635. It is never shown to riders.
_Spanish_: código del feed
_Avoid_: route code (when meaning the joined code)

**Service Hours**:
The hours of the day a Route is published to run.
_Spanish_: horario de servicio
_Avoid_: horario (that is the Timetable), operating hours

**First Trip**:
The earliest Trip of a Route on a given day.
_Spanish_: primer bus
_Avoid_: first departure, opening

**Last Trip**:
The latest Trip of a Route on a given day.
_Spanish_: último bus
_Avoid_: last departure, closing

## Vehicles

**Vehicle**:
One bus or cable car cabin in service.
_Spanish_: bus, cabina, vehículo
_Avoid_: unit, car

**Trip**:
One run of a Vehicle along a Route in one Direction, from its first Stop to its last, at a given time.
_Spanish_: viaje, recorrido
_Avoid_: run, departure, service; using "trip" for a Validation or a Journey

**Running**:
A Vehicle that is in service and reporting where it is.
_Spanish_: en vía
_Avoid_: active, online, moving

**Serving**:
A Vehicle whose current Trip stops at a given Stop.
_Spanish_: para aquí
_Avoid_: incoming (when the Vehicle may already have passed)

**Passing**:
A Vehicle whose current Trip goes by a given Stop without stopping there, like an express skipping a Station.
_Spanish_: no para aquí, pasa de largo
_Avoid_: skipping

**Incoming**:
A Serving Vehicle that has not yet reached the Stop.
_Spanish_: en camino
_Avoid_: nearby, approaching

**Departed**:
A Serving Vehicle that has already left the Stop.
_Spanish_: ya pasó
_Avoid_: gone, missed

## Transit Feed

**TransMilenio S.A.**:
The public company that runs the SITP and publishes the Transit Feed.
_Spanish_: TransMilenio S.A., la empresa
_Avoid_: TransMilenio (on its own), the operator

**Transit Feed**:
The data TransMilenio S.A. publishes about the SITP: the Routes, the Timetable, where Vehicles are, and Service Alerts.
_Spanish_: los datos, el feed
_Avoid_: feed (on its own), data feed, source

**Service Alert**:
A message from TransMilenio S.A. that part of the service is changed or disrupted, such as a detour or a closed Station.
_Spanish_: novedad
_Avoid_: notice, incident, disruption

## Timetable

**Arrival**:
When one Trip is expected at one Stop. Each Arrival is either scheduled, taken from the published plan, or real-time.
_Spanish_: llegada
_Avoid_: departure, ETA, prediction

**Timetable**:
All the Arrivals at a Stop.
_Spanish_: horario
_Avoid_: schedule, horario programado, horario publicado, según horario

## Real-time data

**Real-time**:
Data that reflects what Vehicles are doing now, rather than what the plan says they should be doing.
_Spanish_: en vivo, en tiempo real
_Avoid_: predicted, estimated, live estimate

**Delay**:
How far a real-time Arrival is from its scheduled one; negative when the Vehicle is early.
_Spanish_: retraso, tarde, antes
_Avoid_: lateness, punctuality, offset

**Stale**:
A single piece of real-time data, such as one Vehicle's position, that has not been updated in the last 2 minutes, even though the Transit Feed itself is current. Stale data is never shown as current.
_Spanish_: desactualizado
_Avoid_: old, expired

**Feed Down**:
The whole Transit Feed has not been updated in the last 5 minutes, so everything real-time is Stale at once, and riders see the scheduled Arrivals from that Stale Transit Feed.
_Spanish_: sin datos en vivo
_Avoid_: offline, outage, not publishing

## The rider

**Journey**:
A rider's whole ride from where they start to where they are going, made of one or more Trips, possibly across Systems.
_Spanish_: trayecto
_Avoid_: trip, route

**Saved Stop**:
A Stop the rider has kept on their phone so they can find it again quickly.
_Spanish_: paradero guardado
_Avoid_: favourite, starred, pinned

**Saved Route**:
A Route the rider has kept on their phone so they can find it again quickly.
_Spanish_: ruta guardada
_Avoid_: favourite, starred, pinned

**Nearby Stop**:
A Stop within walking distance of where the rider is now.
_Spanish_: cerca de ti, paradero cercano
_Avoid_: close stop, local stop

## TuLlave card

**Card**:
The rider's TuLlave card. It holds a balance and pays Fares.
_Spanish_: tarjeta, TuLlave
_Avoid_: wallet, pass

**Balance**:
The money on a Card.
_Spanish_: saldo
_Avoid_: credit, funds

**Debt**:
A negative Balance, left when a Validation costs more than the Card held. It comes off the next Top-up.
_Spanish_: saldo a deber, la tarjeta quedó debiendo
_Avoid_: loan, overdraft

**Validation**:
A rider tapping their Card to pay a Fare, at a Station turnstile or at a reader on board.
_Spanish_: validación, validar
_Avoid_: trip, viaje, entry, tap, boarding

**Fare**:
The price charged at a Validation. It depends on the System, and sometimes on the Route.
_Spanish_: tarifa, pasaje
_Avoid_: price, cost, ticket

**Transfer**:
A Validation whose Fare is reduced or free because it came soon after another Validation.
_Spanish_: transbordo
_Avoid_: connection, change

**Top-up**:
Money added to a Card's Balance.
_Spanish_: recarga
_Avoid_: reload, deposit, charge

**Card Movement**:
One record on a Card: a Validation, a Top-up or a cancelled Top-up.
_Spanish_: movimiento
_Avoid_: transaction, history entry

## Citizen Reports

**Citizen Report**:
A public message a rider sends about Paradero's data or the app, open for anyone to follow.
_Spanish_: reporte ciudadano
_Avoid_: report (on its own), feedback, complaint

**Data Correction**:
A Citizen Report saying something from the Transit Feed is wrong, such as a time, a missing Route or Stop, or a Stop in the wrong place.
_Spanish_: corrección
_Avoid_: bug report, data issue

**Suggestion**:
A Citizen Report proposing a change to the app.
_Spanish_: idea, sugerencia
_Avoid_: feature request, wish
