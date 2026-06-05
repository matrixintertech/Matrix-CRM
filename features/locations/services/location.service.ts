import { prisma } from "@/lib/db/prisma";

function normalizeLocationValue(value?: string | null) {
  return value?.trim() || null;
}

function matchesLocationName(value: string, expected: string) {
  return value.localeCompare(expected, undefined, { sensitivity: "accent" }) === 0;
}

export class LocationSelectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LocationSelectionError";
  }
}

export async function listActiveStatesWithCities() {
  return prisma.state.findMany({
    where: {
      isActive: true,
    },
    orderBy: [{ name: "asc" }],
    select: {
      id: true,
      name: true,
      code: true,
      cities: {
        where: {
          isActive: true,
        },
        orderBy: [{ name: "asc" }],
        select: {
          id: true,
          name: true,
        },
      },
    },
  });
}

export async function resolveStateCitySelection(
  input: {
    state?: string | null;
    city?: string | null;
  },
  options?: {
    allowLegacyPair?: boolean;
  }
) {
  const state = normalizeLocationValue(input.state);
  const city = normalizeLocationValue(input.city);

  if (!state && city) {
    throw new LocationSelectionError("Select a state before choosing a city.");
  }

  if (!state) {
    return {
      state: null,
      city: null,
    };
  }

  const matchedState = await prisma.state.findFirst({
    where: {
      isActive: true,
      name: {
        equals: state,
        mode: "insensitive",
      },
    },
    select: {
      name: true,
      cities: {
        where: {
          isActive: true,
        },
        select: {
          name: true,
        },
      },
    },
  });

  if (!matchedState) {
    if (options?.allowLegacyPair) {
      return { state, city };
    }

    throw new LocationSelectionError("Select a valid state.");
  }

  if (!city) {
    return {
      state: matchedState.name,
      city: null,
    };
  }

  const matchedCity = matchedState.cities.find((entry) => matchesLocationName(entry.name, city));
  if (!matchedCity) {
    if (options?.allowLegacyPair) {
      return {
        state: matchedState.name,
        city,
      };
    }

    throw new LocationSelectionError("Select a valid city for the chosen state.");
  }

  return {
    state: matchedState.name,
    city: matchedCity.name,
  };
}
