# simtra

**simulate and predict a city before the real world reacts**

## The idea

What if you could see how people might respond to a product, message, policy, or event before putting it into the real world?

Simtra creates synthetic versions of real cities that you can ask questions. Each city is filled with simulated residents sampled from real US Census data, so the population reflects the city's actual mix of ages, incomes, jobs, education levels, households, and backgrounds.

Instead of getting one generic AI answer, Simtra asks different types of residents and combines their responses using Census population weights. The result is an early signal of how the whole city — and different groups inside it — might react.

Simtra currently covers San Francisco, New York City, Los Angeles, Chicago, and Miami.

## What you can test

- Ask whether residents would support an idea, candidate, policy, or product.
- Compare two versions of a message with an A/B test.
- See how planned marketing copy could shift support.
- Break results down by age, income, education, race, gender, and other groups.
- Read sample reasons from individual synthetic residents.

The pixel-art city makes the result visible: residents across the map react as the prediction is revealed.

## How it works

Every synthetic resident gets a seeded persona, routine, values, location, and demographic profile. When a question is asked, similar residents are grouped together, their likely responses are modeled, and the answers are combined using real Census survey weights.

This is meant to give people a fast signal before launch. It is not a replacement for real surveys, experiments, or talking to actual people.

## Proof of concept

For historical San Francisco tests, Simtra used a model cutoff from before the events so it could not simply recall the outcomes:

- **2024 presidential vote:** 83.8% actual Democratic share, 81.3% predicted.
- **March 2024 Proposition A:** 70.38% actual yes, 70% predicted.

## The goal

Most decisions depend on guessing how people will react. Simtra makes that guess easier to explore before time, money, or trust is spent in the real world.

## Built by

Mahin Bharathwaj, Aradhya Mishra, and Shuzan Zhang
