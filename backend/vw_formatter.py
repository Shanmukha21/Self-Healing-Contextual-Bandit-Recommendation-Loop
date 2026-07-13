def sanitize(text: str) -> str:
    """
    Sanitize keys and values to ensure Vowpal Wabbit compatibility by replacing 
    characters like spaces, pipes, colons, and newlines that have special semantic 
    meaning in VW's input format.
    """
    for char in [" ", ":", "|", "\n", "\r"]:
        text = text.replace(char, "_")
    return text

def to_adf_string(context: dict, actions: list) -> str:
    """
    Converts user context and a list of actions into Vowpal Wabbit's ADF multi-line string format.
    Example output:
      shared |User time=morning device=mobile
      |Action action=Tech_News
      |Action action=Fashion_Tips
    """
    context_features = []
    for k, v in context.items():
        context_features.append(f"{sanitize(str(k))}={sanitize(str(v))}")
    
    shared_line = f"shared |User {' '.join(context_features)}"
    
    action_lines = []
    for act in actions:
        action_lines.append(f"|Action action={sanitize(str(act))}")
        
    return "\n".join([shared_line] + action_lines)

def to_learn_string(context: dict, actions: list, chosen_idx: int, cost: float, prob: float) -> str:
    """
    Converts context, actions, and the cost/probability of the chosen action 
    into the training format for Vowpal Wabbit.
    Example output:
      shared |User time=morning device=mobile
      |Action action=Tech_News
      1:1.000000:0.333333 |Action action=Fashion_Tips
    """
    context_features = []
    for k, v in context.items():
        context_features.append(f"{sanitize(str(k))}={sanitize(str(v))}")
        
    shared_line = f"shared |User {' '.join(context_features)}"
    
    action_lines = []
    for idx, act in enumerate(actions):
        base_line = f"|Action action={sanitize(str(act))}"
        if idx == chosen_idx:
            action_lines.append(f"{chosen_idx}:{cost:.6f}:{prob:.6f} {base_line}")
        else:
            action_lines.append(base_line)
            
    return "\n".join([shared_line] + action_lines)
