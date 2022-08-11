#Source: https://stackoverflow.com/questions/31940285/plot-a-polar-color-wheel-based-on-a-colormap-using-python-matplotlib
import matplotlib.pyplot as plt
import numpy as np
from matplotlib import cm
import matplotlib as mpl

fig = plt.figure(figsize=(10.24,10.24))

display_axes = fig.add_axes([0.01,0.01,0.98,0.98], projection='polar')
display_axes._direction = 2*np.pi ## This is a nasty hack - using the hidden field to 
                                  ## multiply the values such that 1 become 2*pi
                                  ## this field is supposed to take values 1 or -1 only!!

norm = mpl.colors.Normalize(0.0, 2*np.pi)

# Plot the colorbar onto the polar axis
# note - use orientation horizontal so that the gradient goes around
# the wheel rather than centre out
quant_steps = 2048
cb = mpl.colorbar.ColorbarBase(display_axes, cmap=cm.get_cmap('hsv',quant_steps),
    norm=norm, orientation='horizontal')

# aesthetics - get rid of border and axis labels                                   
cb.outline.set_visible(False)                                 
display_axes.set_axis_off()

#plt.show()
plt.savefig('color-wheel.png', transparent=True)
display_axes.set_rlim([-20,1]) # radius limit [min,max]: ring thickness = max/(-min)
plt.savefig('color-ring.png', transparent=True)
