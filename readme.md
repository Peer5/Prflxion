# Prflxion

![](./prflxion.png)

## Introduction

Prflxion is a logical exploit of a sanitization bug in WebRTC that leaks the local IPv4 to the web application.
<br>
Until 2019, Using WebRTC candidates for this kind of leak was well known and used by vendors to accurately target users behind a NAT.
<br>
In 2019, following public pressure, the Chromium Team decided to implement an obfuscation method using the mDNS Protocol.
<br>
In short, mDNS uses the ip multicast feature to resolve local hostnames in a LAN. To make sure it does not cross routers, its TTL is limited to 1.
<br> 
The exploit manipulates the generated candidates to circumvent the IP obfuscation by leveraging a common OS kernel feature.
<br>

## The Vulnerability

The vulnerability lies within the code in the function [Connection::MaybeUpdateLocalCandidate](https://webrtc.googlesource.com/src/+/9f9bf38805e14688acef01fe6814b8ce3a98c09c/p2p/base/connection.cc#1248).
This function is called whenever a `STUN_BINDING_RESPONSE` is [received](https://webrtc.googlesource.com/src/+/9f9bf38805e14688acef01fe6814b8ce3a98c09c/p2p/base/connection.cc#1104) on a `STUN` connection.
The function gets the `XOR_MAPPED_ADDRESS` sent by the `STUN` server - which is the client's IP address as seen by the server when receiving the bind request.
<br>
If the address is found within the current candidates, it changes the connection's local candidate to the one it found. Otherwise, it creates a new local candidate (one that has not been generated or sent by the `STUN`) and assumes it to be a `prflx` candidate.
<br>
The first problem is that the new candidate isn't [Sanitized by the mDNS Obfuscation]((https://webrtc.googlesource.com/src/+/9f9bf38805e14688acef01fe6814b8ce3a98c09c/p2p/base/connection.cc#1297)).
This sanitization is done mainly in basic_port_allocator.cc when [SignalCandidateReady](https://webrtc.googlesource.com/src/+/9f9bf38805e14688acef01fe6814b8ce3a98c09c/p2p/client/basic_port_allocator.cc#966) is called. This signal is sent in [AddAddress](https://webrtc.googlesource.com/src/+/9f9bf38805e14688acef01fe6814b8ce3a98c09c/p2p/base/port.cc) that adds the candidates after the network interface discovery process.
<br>
But the function `MaybeUpdateLocalCandidate` does not signal this. Instead, it calls [AddPrflxCandidate](https://webrtc.googlesource.com/src/+/9f9bf38805e14688acef01fe6814b8ce3a98c09c/p2p/base/port.cc#426) which just adds it as is to the candidate list.

## The Exploit
From first view there is no trivial way to exploit that - to create an un-sanitized candidate we would have to somehow represent the local IPv4 in a way that is
on one hand different from candidate addresses created by the interface enumeration, and on the other hand needs to be supported by the network stack.
<br> To aid us in this task comes IPv6.

### 4in6 encapsulation

As can be seen [here](https://stackoverflow.com/questions/49793630/is-ffff127-0-0-1-localhost), 
[there](https://stackoverflow.com/questions/1618240/how-to-support-both-ipv4-and-ipv6-connections#:~:text=The%20best%20approach%20is%20to,in%20the%20IPv4%2Dmapped%20format.) and [everywhere](https://en.wikipedia.org/wiki/IPv6#IPv4-mapped_IPv6_addresses),
when a client tries to connect in IPv4 to a server with dual-stack enabled that listens to an IPv6 (`AF_INET6`) 
defined socket on `in6addr_any` (`::`), a padding of the IPv4 address to an IPv6 address takes place in the kernel.
this padded IPv6 address is returned from `getaddrinfo()` api (or `recvfrom` in our case) as the remote host.
<br>
for example, assume the following:
- A Client with only IPv4 stackwith ip `192.168.1.24`.
- A dual-stack enabled Server with IPv4 address `192.168.1.25` and IPv6 address `2002:a00:3::1006`
  that is listening on an `AF_INET6`, UDP (`SOCK_DGRAM`) socket. Bound to address `::` and port 1337.
<br>
When the client connects to `192.168.1.25:1337`, the Server's Kernel pads the IPv4 of the client 
  because the server is expecting an IPv6 source IP when `recvfrom` is called.
Thus, the Server will see the client as `::ffff:192.168.1.24`.
  This is the address which will be returned as the `XOR_MAPPED_ADDRESS` in the following exploitation.
<br> 

### Exploitation
So, to exploit this we would need to initiate a `STUN_BIND_REQUEST` that will create a `STUN_BIND_RESPONSE` that has the 4in6 local IPv4 as `XOR_MAPPED_ADDRESS`.
First, we don't define any `STUN` server so the `STUN_BIND_REQUEST`s will be sent directly to the other peer without translation. 
Fortunately, the WebRTC `NetworkManagerBase` class [binds two UDP sockets](https://webrtc.googlesource.com/src/+/9f9bf38805e14688acef01fe6814b8ce3a98c09c/rtc_base/network.cc#284) - one on `INADDR_ANY` (`0.0.0.0`), and another on `in6addr_any` (`::`). These Sockets are used for the `STUN` negotiation.
<br>
So, when we create a `RTCPeerConnection` instance, we would expect that two candidates will be created (and obfuscated) - one with IPv4 and one with IPv6 with corresponding ports.
These two candidates would have two different mDNS names (as per [creation](https://webrtc.googlesource.com/src/+/9f9bf38805e14688acef01fe6814b8ce3a98c09c/p2p/base/port.cc#319)).
<br>
After the two candidates are collected, the exploit replaces the IPv6 candidate mDNS hostname (in JS) with the IPv4 candidate mDNS hostname. A second local connection is passed the malicious IPv6 candidate through `RTCPeerConnection.addIceCandidate()`.
<br>
This results in a local mDNS name resolving of the IPv4 address, but the port that the second connection will try to connect with is the IPv6 defined socket, which means the address reported between the peers through `STUN` will be a 4in6 translated address.
<br>
This results in adding un-sanitized candidate to the WebRTC stats which are available via the RTCPeerConnection.getStats() method.
