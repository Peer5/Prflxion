# PRFLxION

## Introduction

PRFLxION is a logical exploit of a sanitation bug in WEBRTC that leaks the local IPv4 to the web application.
</br>
Until 2019, Using WEBRTC candidates for this kind of leak was well known and used by vendors to accurately target users behind a NAT.
</br>
In 2019, following public pressure, the Chromium Team decided to implement an obfuscation method using the mDNS Protocol.
</br>
In short, mDNS uses the ip multicast feature to resolve local hostnames in a LAN. To make sure it does not cross routers, its TTL is limited to 1.
</br> 
The solution was to change the ip address of the local candidate to a new, locally generated mDNS name. 
</br>

##  The Vulnerability

The vulnerability lies within the code for [MaybeLocalUpdateCandidate](https://webrtc.googlesource.com/src/+/9f9bf38805e14688acef01fe6814b8ce3a98c09c/p2p/base/connection.cc#1248).
This function is called whenever a STUN_BINDING_RESPONSE is recieved [received](https://webrtc.googlesource.com/src/+/9f9bf38805e14688acef01fe6814b8ce3a98c09c/p2p/base/connection.cc#1104).
The function gets the XOR_MAPPED_ADDRESS sent by the STUN server - which is the client ip address from which the STUN server received the bind request.
If the address is found within the already known candidate, it changes the local candidate to srflx. Otherwise, it creates a new local candidate (one that has not been generated or sent by the TURN) and assumes it to be prflx candidate.
</br>
The first problem is that the new candidate isn't [Sanitized by the MDNS Obfuscation]((https://webrtc.googlesource.com/src/+/9f9bf38805e14688acef01fe6814b8ce3a98c09c/p2p/base/connection.cc#1297)).
This sanitization is done mainly in basic_port_allocator.cc when [SignalCandidateReady](https://webrtc.googlesource.com/src/+/9f9bf38805e14688acef01fe6814b8ce3a98c09c/p2p/client/basic_port_allocator.cc#966) is called. This signal is sent in [AddAddress](https://webrtc.googlesource.com/src/+/9f9bf38805e14688acef01fe6814b8ce3a98c09c/p2p/base/port.cc) that adds the candidates after the network interface discovery process.
</br>
But the function MaybeUpdateLocalCandidate does not signal this. Instead it calls [AddPrflxCandidate](https://webrtc.googlesource.com/src/+/9f9bf38805e14688acef01fe6814b8ce3a98c09c/p2p/base/port.cc#426) which just adds it as is to the candidate list.

## The Exploit
From first view there is no trivial way to exploit that - to create an unsanitized candidate we would have to somehow represent the ***local ipv4*** in another way then the WEBRTC NetworkManager which creates all candidates.
</br> To aid us in this task comes IPv6 </br>

### 4in6 encapsulation

As can be seen [here](https://stackoverflow.com/questions/49793630/is-ffff127-0-0-1-localhost), [there](https://stackoverflow.com/questions/1618240/how-to-support-both-ipv4-and-ipv6-connections#:~:text=The%20best%20approach%20is%20to,in%20the%20IPv4%2Dmapped%20format.) and  [everywhere](https://en.wikipedia.org/wiki/IPv6#IPv4-mapped_IPv6_addresses), when an ipv4 tries to connect to an ipv6 defined socket, on a dual-stack enabled computer which listens on in6addr_any - "::", a padding of the ipv4 address to an ipv6 happens in the kernel, and is returned from getaddrinfo(). (or recvfrom in our case).
</br> for example, assume that we have an ipv4 only computer (Client) with ip 192.168.1.24.
A dual stack enabled Server with ipv4 192.168.1.25 and ipv6 2002:a00:3::1006 is listening (UDP) on '::' with AF_INET6 socket listening on '::' and port 1337.</br> When the client connects to 192.168.1.25:1337, the Server's Kernel pads the ipv4 of the client (because the server is expecting an ipv6) when he calls recvfrom.
Thus the Server will see the client as ::ffff:192.168.1.24
</br> 

### Exploitation
So, to exploit this we would need to create a STUN_BIND_REQUEST that will create a STUN_BIND_RESPONSE that has the 4in6 local ipv4 as XOR_MAPPED_ADDRESS.
First, we don't define any STUN server. When candidate pairing is done in that case, the STUN_BIND_REQUEST goes directly to the other peer. 
Fortunately, the WEBRTC [network manager binds two UDP sockets](https://webrtc.googlesource.com/src/+/9f9bf38805e14688acef01fe6814b8ce3a98c09c/rtc_base/network.cc#284)  - one on INADDR_ANY (0.0.0.0), and another on in6addr_any. These Sockets are used to create the local candidates, and also to do the MDNS protocol negotiation.
</br>
So, when we create a PeerConnection object, we would expect that two candidates will be created (and obfuscated) - one with ipv4 and one with ipv6 (with corresponding ports).
These two candidates would have two different MDNS names (as per [creation](https://webrtc.googlesource.com/src/+/9f9bf38805e14688acef01fe6814b8ce3a98c09c/p2p/base/port.cc#319)).
</br>
After these are collected, we will create another PeerConnection. By manipulating the first connection's candidate address (in javascript) replacing in the ipv6 candidate the mDNS name to the ipv4 candidate name. in the new connection we will addIceCandidate the malicious candidate.
</br>
This will result in mDNS name resolving of the ipv4 address, but the port will be the ipv6 one. So the address received will indeed be the 4in6 one.
</br>
This results in adding unsanitized candidate to the WEBRTC stats. and the rest is getStats();



 

  





