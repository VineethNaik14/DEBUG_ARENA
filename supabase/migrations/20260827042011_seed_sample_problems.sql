/*
# Seed 5 sample debugging problems with public and hidden test cases

1. Problems Created
   1. Fix the Broken Loop (Easy, 100 pts) — off-by-one error in a sum loop
   2. Broken Binary Search (Medium, 200 pts) — mid calculation bug
   3. Array Index Bug (Easy, 100 pts) — wrong array indexing
   4. Incorrect Sorting Logic (Medium, 200 pts) — comparison operator bug in bubble sort
   5. Null Pointer Debugging (Hard, 300 pts) — null check missing before dereference

2. Each problem includes:
   - starter_code for Python, C++, and Java
   - public_test_cases (visible to students for "Run Code")
   - hidden test cases stored in problem_hidden_test_cases (invisible to students)

3. Notes
   - All problems are active and ordered 1-5.
   - Test cases use { input, expected_output } format.
*/

-- Problem 1: Fix the Broken Loop
INSERT INTO public.problems (id, title, description, difficulty, points, time_limit, memory_limit, supported_languages, starter_code, public_test_cases, is_active, problem_order)
VALUES (
  gen_random_uuid(),
  'Fix the Broken Loop',
  'The following function is supposed to calculate the sum of integers from 1 to N (inclusive). However, it produces incorrect results for some inputs. Find and fix the bug in the loop.

Expected behavior: sum(N) should return N*(N+1)/2

For example:
- sum(5) should return 15
- sum(10) should return 55
- sum(1) should return 1',
  'EASY',
  100,
  2000,
  256,
  ARRAY['python', 'cpp', 'java'],
  '{
    "python": "def sum_to_n(n):\n    total = 0\n    for i in range(1, n):\n        total += i\n    return total\n\nn = int(input())\nprint(sum_to_n(n))",
    "cpp": "#include <iostream>\nusing namespace std;\n\nint sumToN(int n) {\n    int total = 0;\n    for (int i = 1; i < n; i++) {\n        total += i;\n    }\n    return total;\n}\n\nint main() {\n    int n;\n    cin >> n;\n    cout << sumToN(n) << endl;\n    return 0;\n}",
    "java": "import java.util.Scanner;\n\npublic class Main {\n    public static int sumToN(int n) {\n        int total = 0;\n        for (int i = 1; i < n; i++) {\n            total += i;\n        }\n        return total;\n    }\n\n    public static void main(String[] args) {\n        Scanner sc = new Scanner(System.in);\n        int n = sc.nextInt();\n        System.out.println(sumToN(n));\n    }\n}"
  }',
  '[
    {"input": "5", "expected_output": "15"},
    {"input": "10", "expected_output": "55"},
    {"input": "1", "expected_output": "1"}
  ]'::jsonb,
  true,
  1
);

-- Problem 2: Broken Binary Search
INSERT INTO public.problems (id, title, description, difficulty, points, time_limit, memory_limit, supported_languages, starter_code, public_test_cases, is_active, problem_order)
VALUES (
  gen_random_uuid(),
  'Broken Binary Search',
  'The following binary search implementation has a bug in how the middle index is calculated. This can cause incorrect results or even infinite loops for certain array sizes. Find and fix the bug.

Expected behavior: binary_search(arr, target) should return the index of target in arr, or -1 if not found.

For example:
- binary_search([1, 3, 5, 7, 9], 5) should return 2
- binary_search([1, 3, 5, 7, 9], 4) should return -1
- binary_search([2, 4, 6, 8], 8) should return 3',
  'MEDIUM',
  200,
  2000,
  256,
  ARRAY['python', 'cpp', 'java'],
  '{
    "python": "def binary_search(arr, target):\n    left = 0\n    right = len(arr) - 1\n    while left <= right:\n        mid = (left + right) / 2\n        if arr[mid] == target:\n            return mid\n        elif arr[mid] < target:\n            left = mid + 1\n        else:\n            right = mid - 1\n    return -1\n\narr = list(map(int, input().split()))\ntarget = int(input())\nprint(binary_search(arr, target))",
    "cpp": "#include <iostream>\n#include <vector>\nusing namespace std;\n\nint binarySearch(vector<int>& arr, int target) {\n    int left = 0, right = arr.size() - 1;\n    while (left <= right) {\n        int mid = (left + right) / 2;\n        if (arr[mid] == target) return mid;\n        else if (arr[mid] < target) left = mid + 1;\n        else right = mid - 1;\n    }\n    return -1;\n}\n\nint main() {\n    int n;\n    cin >> n;\n    vector<int> arr(n);\n    for (int i = 0; i < n; i++) cin >> arr[i];\n    int target;\n    cin >> target;\n    cout << binarySearch(arr, target) << endl;\n    return 0;\n}",
    "java": "import java.util.Scanner;\n\npublic class Main {\n    public static int binarySearch(int[] arr, int target) {\n        int left = 0, right = arr.length - 1;\n        while (left <= right) {\n            int mid = (left + right) / 2;\n            if (arr[mid] == target) return mid;\n            else if (arr[mid] < target) left = mid + 1;\n            else right = mid - 1;\n        }\n        return -1;\n    }\n\n    public static void main(String[] args) {\n        Scanner sc = new Scanner(System.in);\n        int n = sc.nextInt();\n        int[] arr = new int[n];\n        for (int i = 0; i < n; i++) arr[i] = sc.nextInt();\n        int target = sc.nextInt();\n        System.out.println(binarySearch(arr, target));\n    }\n}"
  }',
  '[
    {"input": "5\n1 3 5 7 9\n5", "expected_output": "2"},
    {"input": "5\n1 3 5 7 9\n4", "expected_output": "-1"},
    {"input": "4\n2 4 6 8\n8", "expected_output": "3"}
  ]'::jsonb,
  true,
  2
);

-- Problem 3: Array Index Bug
INSERT INTO public.problems (id, title, description, difficulty, points, time_limit, memory_limit, supported_languages, starter_code, public_test_cases, is_active, problem_order)
VALUES (
  gen_random_uuid(),
  'Array Index Bug',
  'The following function should find the maximum element in an array. However, it has an indexing bug that causes it to miss the last element or access the wrong index. Find and fix the bug.

Expected behavior: find_max(arr) should return the maximum value in the array.

For example:
- find_max([3, 1, 4, 1, 5]) should return 5
- find_max([10]) should return 10
- find_max([7, 7, 7]) should return 7',
  'EASY',
  100,
  2000,
  256,
  ARRAY['python', 'cpp', 'java'],
  '{
    "python": "def find_max(arr):\n    max_val = arr[0]\n    for i in range(1, len(arr) - 1):\n        if arr[i] > max_val:\n            max_val = arr[i]\n    return max_val\n\narr = list(map(int, input().split()))\nprint(find_max(arr))",
    "cpp": "#include <iostream>\n#include <vector>\nusing namespace std;\n\nint findMax(vector<int>& arr) {\n    int maxVal = arr[0];\n    for (int i = 1; i < arr.size() - 1; i++) {\n        if (arr[i] > maxVal) maxVal = arr[i];\n    }\n    return maxVal;\n}\n\nint main() {\n    int n;\n    cin >> n;\n    vector<int> arr(n);\n    for (int i = 0; i < n; i++) cin >> arr[i];\n    cout << findMax(arr) << endl;\n    return 0;\n}",
    "java": "import java.util.Scanner;\n\npublic class Main {\n    public static int findMax(int[] arr) {\n        int maxVal = arr[0];\n        for (int i = 1; i < arr.length - 1; i++) {\n            if (arr[i] > maxVal) maxVal = arr[i];\n        }\n        return maxVal;\n    }\n\n    public static void main(String[] args) {\n        Scanner sc = new Scanner(System.in);\n        int n = sc.nextInt();\n        int[] arr = new int[n];\n        for (int i = 0; i < n; i++) arr[i] = sc.nextInt();\n        System.out.println(findMax(arr));\n    }\n}"
  }',
  '[
    {"input": "5\n3 1 4 1 5", "expected_output": "5"},
    {"input": "1\n10", "expected_output": "10"},
    {"input": "3\n7 7 7", "expected_output": "7"}
  ]'::jsonb,
  true,
  3
);

-- Problem 4: Incorrect Sorting Logic
INSERT INTO public.problems (id, title, description, difficulty, points, time_limit, memory_limit, supported_languages, starter_code, public_test_cases, is_active, problem_order)
VALUES (
  gen_random_uuid(),
  'Incorrect Sorting Logic',
  'The following bubble sort implementation has a bug in its comparison logic. Instead of sorting in ascending order, it produces incorrect output for some arrays. Find and fix the bug.

Expected behavior: bubble_sort(arr) should sort the array in ascending order.

For example:
- bubble_sort([5, 3, 1, 4, 2]) should return [1, 2, 3, 4, 5]
- bubble_sort([1]) should return [1]
- bubble_sort([3, 3, 1]) should return [1, 3, 3]',
  'MEDIUM',
  200,
  2000,
  256,
  ARRAY['python', 'cpp', 'java'],
  '{
    "python": "def bubble_sort(arr):\n    n = len(arr)\n    for i in range(n):\n        for j in range(0, n - i - 1):\n            if arr[j] < arr[j + 1]:\n                arr[j], arr[j + 1] = arr[j + 1], arr[j]\n    return arr\n\narr = list(map(int, input().split()))\nprint(bubble_sort(arr))",
    "cpp": "#include <iostream>\n#include <vector>\nusing namespace std;\n\nvoid bubbleSort(vector<int>& arr) {\n    int n = arr.size();\n    for (int i = 0; i < n; i++) {\n        for (int j = 0; j < n - i - 1; j++) {\n            if (arr[j] < arr[j + 1]) {\n                swap(arr[j], arr[j + 1]);\n            }\n        }\n    }\n}\n\nint main() {\n    int n;\n    cin >> n;\n    vector<int> arr(n);\n    for (int i = 0; i < n; i++) cin >> arr[i];\n    bubbleSort(arr);\n    for (int i = 0; i < n; i++) cout << arr[i] << \" \";\n    cout << endl;\n    return 0;\n}",
    "java": "import java.util.Scanner;\n\npublic class Main {\n    public static void bubbleSort(int[] arr) {\n        int n = arr.length;\n        for (int i = 0; i < n; i++) {\n            for (int j = 0; j < n - i - 1; j++) {\n                if (arr[j] < arr[j + 1]) {\n                    int temp = arr[j];\n                    arr[j] = arr[j + 1];\n                    arr[j + 1] = temp;\n                }\n            }\n        }\n    }\n\n    public static void main(String[] args) {\n        Scanner sc = new Scanner(System.in);\n        int n = sc.nextInt();\n        int[] arr = new int[n];\n        for (int i = 0; i < n; i++) arr[i] = sc.nextInt();\n        bubbleSort(arr);\n        for (int i = 0; i < n; i++) System.out.print(arr[i] + \" \");\n        System.out.println();\n    }\n}"
  }',
  '[
    {"input": "5\n5 3 1 4 2", "expected_output": "1 2 3 4 5"},
    {"input": "1\n1", "expected_output": "1"},
    {"input": "3\n3 3 1", "expected_output": "1 3 3"}
  ]'::jsonb,
  true,
  4
);

-- Problem 5: Null Pointer Debugging
INSERT INTO public.problems (id, title, description, difficulty, points, time_limit, memory_limit, supported_languages, starter_code, public_test_cases, is_active, problem_order)
VALUES (
  gen_random_uuid(),
  'Null Pointer Debugging',
  'The following function processes a list of values and should return the sum of all non-null values. However, it crashes when encountering a null/None value because it does not check for null before processing. Find and fix the bug by adding proper null checks.

Expected behavior: sum_non_null(arr) should return the sum of all non-null/non-None values in the array. Return 0 if all values are null.

For example:
- sum_non_null([1, None, 3, None, 5]) should return 9
- sum_non_null([None, None]) should return 0
- sum_non_null([10, 20, 30]) should return 60',
  'HARD',
  300,
  2000,
  256,
  ARRAY['python', 'cpp', 'java'],
  '{
    "python": "def sum_non_null(arr):\n    total = 0\n    for val in arr:\n        total += val\n    return total\n\nline = input().split()\narr = []\nfor x in line:\n    if x == \"null\":\n        arr.append(None)\n    else:\n        arr.append(int(x))\nprint(sum_non_null(arr))",
    "cpp": "#include <iostream>\n#include <vector>\n#include <optional>\nusing namespace std;\n\nint sumNonNull(vector<optional<int>>& arr) {\n    int total = 0;\n    for (auto& val : arr) {\n        total += *val;\n    }\n    return total;\n}\n\nint main() {\n    int n;\n    cin >> n;\n    vector<optional<int>> arr(n);\n    for (int i = 0; i < n; i++) {\n        string s;\n        cin >> s;\n        if (s == \"null\") arr[i] = nullopt;\n        else arr[i] = stoi(s);\n    }\n    cout << sumNonNull(arr) << endl;\n    return 0;\n}",
    "java": "import java.util.Scanner;\n\npublic class Main {\n    public static int sumNonNull(Integer[] arr) {\n        int total = 0;\n        for (Integer val : arr) {\n            total += val;\n        }\n        return total;\n    }\n\n    public static void main(String[] args) {\n        Scanner sc = new Scanner(System.in);\n        int n = sc.nextInt();\n        Integer[] arr = new Integer[n];\n        for (int i = 0; i < n; i++) {\n            String s = sc.next();\n            if (s.equals(\"null\")) arr[i] = null;\n            else arr[i] = Integer.parseInt(s);\n        }\n        System.out.println(sumNonNull(arr));\n    }\n}"
  }',
  '[
    {"input": "5\n1 null 3 null 5", "expected_output": "9"},
    {"input": "2\nnull null", "expected_output": "0"},
    {"input": "3\n10 20 30", "expected_output": "60"}
  ]'::jsonb,
  true,
  5
);

-- Now insert hidden test cases for each problem
-- We need to get the problem IDs. Let''s use a DO block.
DO $$
DECLARE
  p1 uuid; p2 uuid; p3 uuid; p4 uuid; p5 uuid;
BEGIN
  SELECT id INTO p1 FROM public.problems WHERE title = 'Fix the Broken Loop';
  SELECT id INTO p2 FROM public.problems WHERE title = 'Broken Binary Search';
  SELECT id INTO p3 FROM public.problems WHERE title = 'Array Index Bug';
  SELECT id INTO p4 FROM public.problems WHERE title = 'Incorrect Sorting Logic';
  SELECT id INTO p5 FROM public.problems WHERE title = 'Null Pointer Debugging';

  -- Hidden tests for Problem 1
  INSERT INTO public.problem_hidden_test_cases (problem_id, test_case) VALUES
    (p1, '{"input": "100", "expected_output": "5050"}'::jsonb),
    (p1, '{"input": "0", "expected_output": "0"}'::jsonb),
    (p1, '{"input": "1000", "expected_output": "500500"}'::jsonb);

  -- Hidden tests for Problem 2
  INSERT INTO public.problem_hidden_test_cases (problem_id, test_case) VALUES
    (p2, '{"input": "6\n1 2 3 4 5 6\n1", "expected_output": "0"}'::jsonb),
    (p2, '{"input": "6\n1 2 3 4 5 6\n6", "expected_output": "5"}'::jsonb),
    (p2, '{"input": "1\n42\n42", "expected_output": "0"}'::jsonb);

  -- Hidden tests for Problem 3
  INSERT INTO public.problem_hidden_test_cases (problem_id, test_case) VALUES
    (p3, '{"input": "6\n5 2 8 1 9 3", "expected_output": "9"}'::jsonb),
    (p3, '{"input": "2\n-5 -3", "expected_output": "-3"}'::jsonb),
    (p3, '{"input": "4\n100 200 50 150", "expected_output": "200"}'::jsonb);

  -- Hidden tests for Problem 4
  INSERT INTO public.problem_hidden_test_cases (problem_id, test_case) VALUES
    (p4, '{"input": "6\n10 5 8 3 1 7", "expected_output": "1 3 5 7 8 10"}'::jsonb),
    (p4, '{"input": "5\n5 5 5 5 5", "expected_output": "5 5 5 5 5"}'::jsonb),
    (p4, '{"input": "4\n4 3 2 1", "expected_output": "1 2 3 4"}'::jsonb);

  -- Hidden tests for Problem 5
  INSERT INTO public.problem_hidden_test_cases (problem_id, test_case) VALUES
    (p5, '{"input": "7\n1 null 2 null 3 null 4", "expected_output": "10"}'::jsonb),
    (p5, '{"input": "1\nnull", "expected_output": "0"}'::jsonb),
    (p5, '{"input": "5\n100 null 200 null 300", "expected_output": "600"}'::jsonb);
END $$;
