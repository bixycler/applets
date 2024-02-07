# Precondition: a, b > 0
def gcd_sub(a, b):
    while min(a,b) > 0:
        (a, b) = ( abs(a - b),  min(a,b) )
        #print(a,b) #DEBUG
    #return (a,b)
    return b
    #return a # b is mistakenly assumed to be 0, since b = min(a,b) inside the loop which finishes at min(a,b) == 0

# Precondition: a >= b > 0
def gcd_mod(a, b):
    while b > 0:
        (a, b) = (b, a % b)
        #print(a,b) #DEBUG
    #return (a,b)
    return a


######### main (testing)

import time

print("GCD(15, 6) = %d (gcd_sub) = %d (gcd_mod) "%(gcd_sub(15,6), gcd_mod(15,6)))

ts = time.clock()
print("GCD(2^1000+2^100+10, 2^111+6) = %d (gcd_mod) "%(gcd_mod(2**1000+2**100+10,2**111+6)))
ts = time.clock() - ts
print("Computation time = %f sec"%(ts))

ts = time.clock()
print("GCD(2^25, 2^5+1) = %d (gcd_sub)"%(gcd_sub(2**25,2**5+1)))
ts = time.clock() - ts
print("Computation time = %f sec"%(ts))

ts = time.clock()
print("GCD(2^25, 5+1) = %d (gcd_sub)"%(gcd_sub(2**25,5+1)))
ts = time.clock() - ts
print("Computation time = %f sec"%(ts))
