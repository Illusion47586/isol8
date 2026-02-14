import pandas as pd
import numpy as np

# Create a sample dataframe
df = pd.DataFrame({
    'A': np.random.rand(5),
    'B': np.random.rand(5)
})

print("DataFrame Summary:")
print(df.describe())

print("\nMean of column A:", df['A'].mean())
